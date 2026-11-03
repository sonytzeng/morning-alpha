// SYNTHETIC ONLY. No real issuer values, source receipt or permission.
export function syntheticIssuerPdfActual() {
 const flags={source_admission:false,quality_admission:false,member_publication:false,
  symbol_to_issuer_mapping_reviewed:false,accounting_classification_reviewed:false};
 const common={entity:'2330',source_sha256:'a'.repeat(64),fiscal_period:'2026Q2',
  period_start:'2026-04-01',period_end:'2026-06-30',scope:'CONSOLIDATED',currency:'TWD',
  period_basis:'DIRECT_THREE_MONTHS',...flags,cell:{page:6,bbox:[100,200,130,210]}};
 return {contract:'issuer-pdf-descriptor-candidate-v1',descriptor_is_approval:false,private_operator_only:true,
  untrusted_service_sandbox:false,...flags,entity:'2330',source_url:'https://synthetic.invalid/quarter.pdf',
  source_sha256:'a'.repeat(64),source_bytes:1234,descriptor_sha256:'b'.repeat(64),receipt_sha256:'c'.repeat(64),
  first_seen_at:'2026-10-19T01:00:00.000001Z',source_received_at:'2026-10-19T01:00:00.000002Z',
  source_available_at:'2026-10-19T01:00:00.000003Z',first_verified_at:'2026-10-19T01:00:00.000004Z',
  normalization_available_at:'2026-10-19T01:00:00.000005Z',conservative_available_at:'2026-10-19T01:00:00.000006Z',
  capture_kind:'HTTP_RESPONSE_RECEIPT',http_status:200,http_status_observed:true,
  announced_at:null,source_version:null,revision_chain:null,legal_reuse_approval:null,
  ytd_or_annual_subtraction_used:false,canonical_writer_invoked:false,
  accounting:{classification:'FSC_ENDORSED_IAS34_INTERIM'},
  period_evidence:{year:2026,quarter:2,period_start:common.period_start,period_end:common.period_end},
  source_path:'PRIVATE_SYNTHETIC_PATH_NOT_OUTPUT',
  rows:[{...common,metric:'revenue',value_decimal:'123456789',unit:'TWD',multiplier:'1',display_resolution_decimal:'1',share_proof:null},
   {...common,metric:'basic_eps',value_decimal:'1.25',unit:'TWD/ordinary_share',multiplier:'1',display_resolution_decimal:'0.01',
    share_proof:{share_class:'ORDINARY',eps_basis:'BASIC'}}]};
}
