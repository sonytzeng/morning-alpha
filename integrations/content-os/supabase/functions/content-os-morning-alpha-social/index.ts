import {
  adminClient,
  asObject,
  authenticateWorker,
  databaseError,
  type JsonRecord,
  jsonResponse,
  readJson,
  type RuntimeClient,
  RuntimeError,
  serve,
  sha256Hex,
  textValue,
} from "../_shared/content-os-runtime-core.ts";
import {
  buildPublicSocialPackage,
  PUBLIC_SOCIAL_ENGINE_VERSION,
  PUBLIC_SOCIAL_PLATFORMS,
  type PublicSocialPackage,
} from "../_shared/content-os-public-social.ts";

type ContentJob = {
  id: string;
  organization_id: string;
  workspace_id: string;
  brand_id: string;
  source_snapshot_id: string;
  selection_run_id: string | null;
  status: string;
  status_version: number;
  current_revision: number;
};

type SelectionRun = {
  id: string;
  public_story_id: string;
  report_date: string;
};

function jobFrom(value: unknown): ContentJob {
  const row = asObject(value);
  const id = textValue(row.id);
  const organizationId = textValue(row.organization_id);
  const workspaceId = textValue(row.workspace_id);
  const brandId = textValue(row.brand_id);
  const sourceSnapshotId = textValue(row.source_snapshot_id);
  const status = textValue(row.status);
  const statusVersion = Number(row.status_version);
  const currentRevision = Number(row.current_revision);
  if (
    !id || !organizationId || !workspaceId || !brandId || !sourceSnapshotId ||
    !status ||
    !Number.isInteger(statusVersion) || statusVersion < 1 ||
    !Number.isInteger(currentRevision) || currentRevision < 1
  ) throw new RuntimeError("CONTENT_JOB_CONTRACT_INVALID", 503);
  return {
    id,
    organization_id: organizationId,
    workspace_id: workspaceId,
    brand_id: brandId,
    source_snapshot_id: sourceSnapshotId,
    selection_run_id: textValue(row.selection_run_id),
    status,
    status_version: statusVersion,
    current_revision: currentRevision,
  };
}

async function readJob(
  admin: RuntimeClient,
  jobId: string,
): Promise<ContentJob> {
  const { data, error } = await admin.from("content_jobs")
    .select(
      "id,organization_id,workspace_id,brand_id,source_snapshot_id,selection_run_id,status,status_version,current_revision",
    )
    .eq("id", jobId)
    .single();
  if (error || !data) throw databaseError(error, "CONTENT_JOB_NOT_FOUND");
  return jobFrom(data);
}

async function transition(
  admin: RuntimeClient,
  job: ContentJob,
  targetStatus: string,
  reason: string,
  waitReason: string | null = null,
): Promise<ContentJob> {
  const { data, error } = await admin.rpc("transition_content_job", {
    target_content_job_id: job.id,
    target_status: targetStatus,
    reason,
    expected_status_version: job.status_version,
    target_wait_reason: waitReason,
    target_resume_from_status: waitReason ? job.status : null,
  });
  if (error || !data) {
    throw databaseError(error, "CONTENT_JOB_TRANSITION_FAILED");
  }
  return jobFrom(data);
}

async function lockPublicSelection(
  admin: RuntimeClient,
  job: ContentJob,
  content: PublicSocialPackage,
): Promise<SelectionRun> {
  const { data, error } = await admin.rpc(
    "content_os_lock_verified_public_selection",
    {
      target_content_job_id: job.id,
      target_engine_version: PUBLIC_SOCIAL_ENGINE_VERSION,
      target_public_story_id: content.publicStoryId,
      target_public_payload: content.selectionPublicPayload,
      target_selection_reason:
        "Verified Morning Alpha public projection; premium content was not consumed.",
      target_exposure_policy: {
        maxPublicCoreStories: 1,
        publicStoryId: content.publicStoryId,
        expectedPlatforms: PUBLIC_SOCIAL_PLATFORMS,
      },
    },
  );
  if (error || !data) {
    throw databaseError(error, "PUBLIC_SELECTION_LOCK_FAILED");
  }
  const row = asObject(data);
  const id = textValue(row.id);
  const publicStoryId = textValue(row.public_story_id);
  const reportDate = textValue(row.report_date);
  if (!id || !publicStoryId || !reportDate) {
    throw new RuntimeError("PUBLIC_SELECTION_CONTRACT_INVALID", 503);
  }
  return { id, public_story_id: publicStoryId, report_date: reportDate };
}

async function ensureGenerationRun(
  admin: RuntimeClient,
  job: ContentJob,
  stage: "script" | "platform_adaptation",
  inputHash: string,
): Promise<{ id: string; status: string; output_hash: string | null }> {
  const idempotencyKey =
    `${job.id}:revision:${job.current_revision}:stage:${stage}:${inputHash}`;
  const { data: existing, error: readError } = await admin.from(
    "generation_runs",
  )
    .select("id,status,input_hash,output_hash,provider")
    .eq("brand_id", job.brand_id)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (readError) throw databaseError(readError, "GENERATION_RUN_READ_FAILED");
  if (existing) {
    if (
      existing.input_hash !== inputHash ||
      existing.provider !== "verified_public_projection_v1"
    ) {
      throw new RuntimeError("GENERATION_RUN_IDEMPOTENCY_CONFLICT", 409);
    }
    return {
      id: existing.id,
      status: existing.status,
      output_hash: textValue(existing.output_hash),
    };
  }
  const { data, error } = await admin.from("generation_runs").insert({
    organization_id: job.organization_id,
    workspace_id: job.workspace_id,
    brand_id: job.brand_id,
    content_job_id: job.id,
    stage,
    provider: "verified_public_projection_v1",
    model: null,
    idempotency_key: idempotencyKey,
    input_hash: inputHash,
    status: "running",
    estimated_cost: 0,
    actual_cost: 0,
    currency: "USD",
    started_at: new Date().toISOString(),
    attempt_count: 1,
    max_attempts: 1,
  }).select("id,status,output_hash").single();
  if (error || !data) {
    throw databaseError(error, "GENERATION_RUN_CREATE_FAILED");
  }
  return {
    id: data.id,
    status: data.status,
    output_hash: textValue(data.output_hash),
  };
}

async function completeGenerationRun(
  admin: RuntimeClient,
  runId: string,
  outputReference: string,
  outputHash: string,
): Promise<void> {
  const { error } = await admin.from("generation_runs").update({
    status: "succeeded",
    output_reference: outputReference,
    output_hash: outputHash,
    actual_cost: 0,
    finished_at: new Date().toISOString(),
    error_code: null,
    error_detail: null,
  }).eq("id", runId);
  if (error) throw databaseError(error, "GENERATION_RUN_COMPLETE_FAILED");
}

async function ensureScript(
  admin: RuntimeClient,
  job: ContentJob,
  selection: SelectionRun,
  content: PublicSocialPackage,
  generationRunId: string,
): Promise<{ id: string; content_hash: string }> {
  const { data: existing, error: readError } = await admin.from(
    "content_scripts",
  )
    .select(
      "id,title,script_text,content_hash,selection_run_id,public_story_id",
    )
    .eq("content_job_id", job.id)
    .eq("revision", job.current_revision)
    .eq("language", "zh-Hant")
    .maybeSingle();
  if (readError) throw databaseError(readError, "CONTENT_SCRIPT_READ_FAILED");
  if (existing) {
    if (
      existing.title !== content.script.title ||
      existing.script_text !== content.script.text ||
      existing.selection_run_id !== selection.id ||
      existing.public_story_id !== selection.public_story_id
    ) throw new RuntimeError("CONTENT_SCRIPT_IDEMPOTENCY_CONFLICT", 409);
    return { id: existing.id, content_hash: existing.content_hash };
  }
  const { data, error } = await admin.from("content_scripts").insert({
    organization_id: job.organization_id,
    workspace_id: job.workspace_id,
    brand_id: job.brand_id,
    content_job_id: job.id,
    generation_run_id: generationRunId,
    revision: job.current_revision,
    language: "zh-Hant",
    title: content.script.title,
    script_text: content.script.text,
    content_hash: "0".repeat(64),
    status: "draft",
    selection_run_id: selection.id,
    public_story_id: selection.public_story_id,
  }).select("id,content_hash").single();
  if (error || !data) {
    throw databaseError(error, "CONTENT_SCRIPT_CREATE_FAILED");
  }
  return { id: data.id, content_hash: data.content_hash };
}

async function ensurePlatforms(
  admin: RuntimeClient,
  job: ContentJob,
  selection: SelectionRun,
  content: PublicSocialPackage,
): Promise<Array<{ id: string; platform: string; content_hash: string }>> {
  const rows = [];
  for (const platform of content.platforms) {
    const { data: existing, error: readError } = await admin.from(
      "platform_contents",
    )
      .select(
        "id,platform,title,caption,hashtags,content_hash,selection_run_id,public_story_id,exposure_date",
      )
      .eq("content_job_id", job.id)
      .eq("revision", job.current_revision)
      .eq("platform", platform.platform)
      .maybeSingle();
    if (readError) {
      throw databaseError(readError, "PLATFORM_CONTENT_READ_FAILED");
    }
    if (existing) {
      const hashtags = Array.isArray(existing.hashtags)
        ? existing.hashtags
        : [];
      if (
        existing.title !== platform.title ||
        existing.caption !== platform.caption ||
        JSON.stringify(hashtags) !== JSON.stringify(platform.hashtags) ||
        existing.selection_run_id !== selection.id ||
        existing.public_story_id !== selection.public_story_id ||
        existing.exposure_date !== selection.report_date
      ) throw new RuntimeError("PLATFORM_CONTENT_IDEMPOTENCY_CONFLICT", 409);
      rows.push({
        id: existing.id,
        platform: existing.platform,
        content_hash: existing.content_hash,
      });
      continue;
    }
    const { data, error } = await admin.from("platform_contents").insert({
      organization_id: job.organization_id,
      workspace_id: job.workspace_id,
      brand_id: job.brand_id,
      content_job_id: job.id,
      revision: job.current_revision,
      platform: platform.platform,
      title: platform.title,
      caption: platform.caption,
      hashtags: platform.hashtags,
      content_hash: "0".repeat(64),
      status: "review",
      selection_run_id: selection.id,
      public_story_id: selection.public_story_id,
      exposure_date: selection.report_date,
    }).select("id,platform,content_hash").single();
    if (error || !data) {
      throw databaseError(error, "PLATFORM_CONTENT_CREATE_FAILED");
    }
    rows.push(data);
  }
  return rows;
}

async function processJob(
  admin: RuntimeClient,
  jobId: string,
): Promise<JsonRecord> {
  let job = await readJob(admin, jobId);
  if (
    !["planning", "topic_selected", "script_generation", "manual_review"]
      .includes(job.status)
  ) {
    throw new RuntimeError("CONTENT_JOB_STATE_NOT_SUPPORTED", 409);
  }
  const { data: brand, error: brandError } = await admin.from("brands")
    .select("slug,pipeline_adapter_key,status")
    .eq("id", job.brand_id)
    .single();
  if (brandError || !brand) {
    throw databaseError(brandError, "BRAND_READ_FAILED");
  }
  if (
    brand.slug !== "morning-alpha" ||
    brand.pipeline_adapter_key !== "morning_alpha_event_v1" ||
    brand.status !== "active"
  ) {
    throw new RuntimeError("MORNING_ALPHA_ACTIVE_BRAND_REQUIRED", 409);
  }

  const { data: snapshot, error: snapshotError } = await admin.from(
    "source_snapshots",
  )
    .select(
      "id,external_object_id,external_revision,content_hash,verification_status,data_quality,payload,expires_at",
    )
    .eq("id", job.source_snapshot_id)
    .single();
  if (snapshotError || !snapshot) {
    throw databaseError(snapshotError, "SOURCE_SNAPSHOT_READ_FAILED");
  }
  if (
    snapshot.verification_status !== "verified" ||
    snapshot.data_quality !== "complete" ||
    !snapshot.expires_at || new Date(snapshot.expires_at) <= new Date()
  ) throw new RuntimeError("VERIFIED_PUBLIC_SOURCE_REQUIRED", 409);

  const content = buildPublicSocialPackage(snapshot.payload, {
    externalObjectId: snapshot.external_object_id,
    externalRevision: snapshot.external_revision,
  });
  const selection = await lockPublicSelection(admin, job, content);
  job = await readJob(admin, job.id);

  if (job.status === "planning") {
    job = await transition(
      admin,
      job,
      "topic_selected",
      "Verified public story selection locked.",
    );
  }
  if (job.status === "topic_selected") {
    job = await transition(
      admin,
      job,
      "script_generation",
      "Begin public-only text generation.",
    );
  }

  const scriptRun = await ensureGenerationRun(
    admin,
    job,
    "script",
    snapshot.content_hash,
  );
  const script = await ensureScript(
    admin,
    job,
    selection,
    content,
    scriptRun.id,
  );
  await completeGenerationRun(
    admin,
    scriptRun.id,
    `content_scripts:${script.id}`,
    script.content_hash,
  );

  const platformInputHash = await sha256Hex({
    source: snapshot.content_hash,
    script: script.content_hash,
  });
  const platformRun = await ensureGenerationRun(
    admin,
    job,
    "platform_adaptation",
    platformInputHash,
  );
  const platforms = await ensurePlatforms(admin, job, selection, content);
  const aggregateHash = await sha256Hex(
    platforms.map(({ platform, content_hash }) => ({ platform, content_hash })),
  );
  await completeGenerationRun(
    admin,
    platformRun.id,
    `platform_contents:${job.id}:${job.current_revision}`,
    aggregateHash,
  );

  if (job.status === "script_generation") {
    job = await transition(
      admin,
      job,
      "manual_review",
      "Public text/social artifacts generated; canonical editorial and leakage review remains required.",
      "audit_required",
    );
  }

  return {
    job_id: job.id,
    status: job.status,
    report_date: content.reportDate,
    source_revision_id: content.revisionId,
    selection_run_id: selection.id,
    public_story_id: selection.public_story_id,
    script_id: script.id,
    platforms: platforms.map((row) => ({ id: row.id, platform: row.platform })),
    video_render_status: "SKIPPED_NOT_CONFIGURED",
    idempotent: scriptRun.status === "succeeded" &&
      platformRun.status === "succeeded",
  };
}

async function run(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    throw new RuntimeError("METHOD_NOT_ALLOWED", 405);
  }
  const admin = adminClient();
  await authenticateWorker(request, admin);
  const body = await readJson(request);
  if (textValue(body.action) !== "run-public-social") {
    throw new RuntimeError("ACTION_NOT_SUPPORTED", 400);
  }
  const jobId = textValue(body.job_id);
  if (!jobId) throw new RuntimeError("CONTENT_JOB_ID_REQUIRED", 400);
  const result = await processJob(admin, jobId);
  return jsonResponse(request, {
    ok: true,
    processed_at: new Date().toISOString(),
    result,
  });
}

Deno.serve((request) => serve(request, run));
