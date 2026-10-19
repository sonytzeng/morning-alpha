// Compiler-only official TypeScript 5.8.3 WebAuthn declarations.
// Exact upstream declaration text; no runtime credential implementation.


interface AuthenticationExtensionsClientInputs {
    appid?: string;
    credProps?: boolean;
    hmacCreateSecret?: boolean;
    minPinLength?: boolean;
    prf?: AuthenticationExtensionsPRFInputs;
}


interface AuthenticationExtensionsClientOutputs {
    appid?: boolean;
    credProps?: CredentialPropertiesOutput;
    hmacCreateSecret?: boolean;
    prf?: AuthenticationExtensionsPRFOutputs;
}


interface AuthenticationExtensionsPRFInputs {
    eval?: AuthenticationExtensionsPRFValues;
    evalByCredential?: Record<string, AuthenticationExtensionsPRFValues>;
}


interface AuthenticationExtensionsPRFOutputs {
    enabled?: boolean;
    results?: AuthenticationExtensionsPRFValues;
}


interface AuthenticationExtensionsPRFValues {
    first: BufferSource;
    second?: BufferSource;
}


interface AuthenticatorSelectionCriteria {
    authenticatorAttachment?: AuthenticatorAttachment;
    requireResidentKey?: boolean;
    residentKey?: ResidentKeyRequirement;
    userVerification?: UserVerificationRequirement;
}


interface CredentialCreationOptions {
    publicKey?: PublicKeyCredentialCreationOptions;
    signal?: AbortSignal;
}


interface CredentialPropertiesOutput {
    rk?: boolean;
}


interface CredentialRequestOptions {
    mediation?: CredentialMediationRequirement;
    publicKey?: PublicKeyCredentialRequestOptions;
    signal?: AbortSignal;
}


interface PublicKeyCredentialCreationOptions {
    attestation?: AttestationConveyancePreference;
    authenticatorSelection?: AuthenticatorSelectionCriteria;
    challenge: BufferSource;
    excludeCredentials?: PublicKeyCredentialDescriptor[];
    extensions?: AuthenticationExtensionsClientInputs;
    pubKeyCredParams: PublicKeyCredentialParameters[];
    rp: PublicKeyCredentialRpEntity;
    timeout?: number;
    user: PublicKeyCredentialUserEntity;
}


interface PublicKeyCredentialDescriptor {
    id: BufferSource;
    transports?: AuthenticatorTransport[];
    type: PublicKeyCredentialType;
}


interface PublicKeyCredentialEntity {
    name: string;
}


interface PublicKeyCredentialParameters {
    alg: COSEAlgorithmIdentifier;
    type: PublicKeyCredentialType;
}


interface PublicKeyCredentialRequestOptions {
    allowCredentials?: PublicKeyCredentialDescriptor[];
    challenge: BufferSource;
    extensions?: AuthenticationExtensionsClientInputs;
    rpId?: string;
    timeout?: number;
    userVerification?: UserVerificationRequirement;
}


interface PublicKeyCredentialRpEntity extends PublicKeyCredentialEntity {
    id?: string;
}


interface PublicKeyCredentialUserEntity extends PublicKeyCredentialEntity {
    displayName: string;
    id: BufferSource;
}


/**
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AuthenticatorAssertionResponse)
 */
interface AuthenticatorAssertionResponse extends AuthenticatorResponse {
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/AuthenticatorAssertionResponse/authenticatorData) */
    readonly authenticatorData: ArrayBuffer;
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/AuthenticatorAssertionResponse/signature) */
    readonly signature: ArrayBuffer;
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/AuthenticatorAssertionResponse/userHandle) */
    readonly userHandle: ArrayBuffer | null;
}


/**
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AuthenticatorAttestationResponse)
 */
interface AuthenticatorAttestationResponse extends AuthenticatorResponse {
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/AuthenticatorAttestationResponse/attestationObject) */
    readonly attestationObject: ArrayBuffer;
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/AuthenticatorAttestationResponse/getAuthenticatorData) */
    getAuthenticatorData(): ArrayBuffer;
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/AuthenticatorAttestationResponse/getPublicKey) */
    getPublicKey(): ArrayBuffer | null;
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/AuthenticatorAttestationResponse/getPublicKeyAlgorithm) */
    getPublicKeyAlgorithm(): COSEAlgorithmIdentifier;
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/AuthenticatorAttestationResponse/getTransports) */
    getTransports(): string[];
}


/**
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AuthenticatorResponse)
 */
interface AuthenticatorResponse {
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/AuthenticatorResponse/clientDataJSON) */
    readonly clientDataJSON: ArrayBuffer;
}


/**
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Credential)
 */
interface Credential {
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Credential/id) */
    readonly id: string;
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/Credential/type) */
    readonly type: string;
}


/**
 * Available only in secure contexts.
 *
 * [MDN Reference](https://developer.mozilla.org/docs/Web/API/PublicKeyCredential)
 */
interface PublicKeyCredential extends Credential {
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/PublicKeyCredential/authenticatorAttachment) */
    readonly authenticatorAttachment: string | null;
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/PublicKeyCredential/rawId) */
    readonly rawId: ArrayBuffer;
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/PublicKeyCredential/response) */
    readonly response: AuthenticatorResponse;
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/PublicKeyCredential/getClientExtensionResults) */
    getClientExtensionResults(): AuthenticationExtensionsClientOutputs;
    /** [MDN Reference](https://developer.mozilla.org/docs/Web/API/PublicKeyCredential/toJSON) */
    toJSON(): PublicKeyCredentialJSON;
}

type COSEAlgorithmIdentifier = number;

type PublicKeyCredentialJSON = any;

type AttestationConveyancePreference = "direct" | "enterprise" | "indirect" | "none";

type AuthenticatorAttachment = "cross-platform" | "platform";

type AuthenticatorTransport = "ble" | "hybrid" | "internal" | "nfc" | "usb";

type CredentialMediationRequirement = "conditional" | "optional" | "required" | "silent";

type PublicKeyCredentialType = "public-key";

type ResidentKeyRequirement = "discouraged" | "preferred" | "required";

type UserVerificationRequirement = "discouraged" | "preferred" | "required";
