export type SocialTone = "engaging" | "professional" | "casual" | "creative" | "bold";

export interface GenerateCaptionRequest {
  topic: string;
  tone?: SocialTone;
  targetAudience?: string;
  imageContext?: string;
  callToAction?: string;
}

export interface CaptionAlternative {
  caption: string;
  style: string;
}

export interface GenerateCaptionResponse {
  primaryCaption: string;
  hashtags: string[];
  callToAction: string;
  alternatives: CaptionAlternative[];
}

export interface DriveConfigStatus {
  configured: boolean;
  clientIdPresent: boolean;
  message: string;
  setupInstructions: {
    title: string;
    steps: string[];
  };
}

export interface InstagramConfigStatus {
  connected: boolean;
  accountType: "personal" | "business" | "creator" | "none";
  accountHandle?: string;
  publishingEligible: boolean;
  publishingMode: "mock" | "disabled";
  provider: "mock" | "none";
  message: string;
  requirements: string[];
}

export interface SocialIntegrationStatus {
  drive: DriveConfigStatus;
  instagram: InstagramConfigStatus;
}

export interface ApproveDraftRequest {
  draftId?: string;
  image: {
    fileName: string;
    mimeType: string;
    fileSize?: number;
    source: "local" | "drive";
    driveFileId?: string;
  };
  caption: string;
  hashtags: string[];
  callToAction?: string;
  ownershipConfirmed: boolean;
}

export type PublishingStatus = "unavailable_personal_account" | "succeeded_mock" | "failed_mock";

export interface ApprovedDraftRecord {
  id: string;
  image: {
    fileName: string;
    mimeType: string;
    fileSize?: number;
    source: "local" | "drive";
    driveFileId?: string;
  };
  caption: string;
  hashtags: string[];
  callToAction?: string;
  status: "approved";
  approvedAt: string;
  ownershipConfirmed: boolean;
  publishingStatus: PublishingStatus;
  latestAttemptId?: string;
}

export type PublishingAttemptState =
  | "not_started"
  | "pending"
  | "processing"
  | "succeeded_mock"
  | "failed"
  | "unknown";

export interface PublishingAttemptRecord {
  attemptId: string;
  draftId: string;
  provider: "mock";
  state: PublishingAttemptState;
  createdAt: string;
  updatedAt: string;
  attemptNumber: number;
  idempotencyKey?: string;
  result?: {
    mockPermalink: string;
    simulatedPostId: string;
    simulatedAt: string;
  };
  error?: {
    code: string;
    message: string;
  };
  auditCorrelationId: string;
}

export interface MockPublishRequest {
  draftId: string;
  confirmedPublish: boolean;
  idempotencyKey?: string;
}

export interface SocialAuditEvent {
  eventId: string;
  timestamp: string;
  action:
    | "social.draft.approved"
    | "social.mock_publish.started"
    | "social.mock_publish.succeeded"
    | "social.mock_publish.failed"
    | "social.startup.reconciled"
    | "social.post.prepared"
    | "social.post.published";
  draftId?: string;
  attemptId?: string;
  details: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Multi-Platform Social Media Publishing Types (LinkedIn, Instagram, X)
// ---------------------------------------------------------------------------

export type SocialPlatform = "instagram" | "linkedin" | "twitter";

export interface PlatformLimit {
  maxCharacters: number;
  maxHashtags: number;
  supportedImageTypes: string[];
  maxImageBytes: number;
}

export const PLATFORM_LIMITS: Record<SocialPlatform, PlatformLimit> = {
  twitter: {
    maxCharacters: 280,
    maxHashtags: 3,
    supportedImageTypes: ["image/jpeg", "image/png", "image/webp"],
    maxImageBytes: 5 * 1024 * 1024, // 5MB
  },
  linkedin: {
    maxCharacters: 3000,
    maxHashtags: 5,
    supportedImageTypes: ["image/jpeg", "image/png", "image/webp"],
    maxImageBytes: 10 * 1024 * 1024, // 10MB
  },
  instagram: {
    maxCharacters: 2200,
    maxHashtags: 15,
    supportedImageTypes: ["image/jpeg", "image/png"],
    maxImageBytes: 8 * 1024 * 1024, // 8MB
  },
};

export interface MultiPlatformCaptionItem {
  platform: SocialPlatform;
  caption: string;
  characterCount: number;
  maxCharacters: number;
  hashtags: string[];
  callToAction?: string;
  compliant: boolean;
}

export interface GenerateMultiPlatformCaptionsRequest {
  topic: string;
  platforms?: SocialPlatform[];
  tone?: SocialTone;
  targetAudience?: string;
  imageContext?: string;
  callToAction?: string;
}

export interface GenerateMultiPlatformCaptionsResponse {
  captions: Record<SocialPlatform, MultiPlatformCaptionItem>;
  generatedAt: string;
}

export interface ValidateImageRequest {
  filePath?: string;
  fileName?: string;
  base64Data?: string;
  mimeType?: string;
  fileSize?: number;
}

export interface ValidateImageResponse {
  valid: boolean;
  fileName: string;
  mimeType: string;
  fileSize: number;
  base64Data?: string;
  error?: string;
}

export interface MultiPlatformPublishRequest {
  platforms: SocialPlatform[];
  image: {
    fileName: string;
    mimeType: string;
    fileSize: number;
    base64Data?: string;
    filePath?: string;
  };
  captions: Partial<Record<SocialPlatform, string>>;
  ownershipConfirmed: boolean;
  userApproved: boolean;
  idempotencyKey?: string;
}

export interface PlatformPublishResult {
  platform: SocialPlatform;
  status: "published" | "succeeded_mock" | "failed";
  publishedUrl?: string;
  postId?: string;
  error?: string;
  publishedAt: string;
}

export interface MultiPlatformPublishResponse {
  workflowId: string;
  overallStatus: "completed" | "partial" | "failed";
  results: Record<string, PlatformPublishResult>;
  auditEventId: string;
  timestamp: string;
}

export interface LinkedInConfigStatus {
  connected: boolean;
  accountName?: string;
  memberUrn?: string;
  pictureUrl?: string;
  hasToken: boolean;
  expiresAt?: number;
  publishingEligible: boolean;
  publishingMode: "api" | "browser" | "disabled";
  message: string;
  requirements: string[];
}

export interface LinkedInAccountRecord {
  memberUrn: string;
  name: string;
  email?: string;
  pictureUrl?: string;
  accessToken: string;
  expiresAt: number;
  scopes: string[];
  connectedAt: string;
}

export interface LinkedInOAuthStateRecord {
  state: string;
  createdAt: number;
  expiresAt: number;
}

export interface TwitterConfigStatus {
  connected: boolean;
  accountHandle?: string;
  publishingEligible: boolean;
  publishingMode: "api" | "browser" | "disabled";
  message: string;
  requirements: string[];
}

export interface MultiPlatformIntegrationStatus {
  drive: DriveConfigStatus;
  instagram: InstagramConfigStatus;
  linkedin: LinkedInConfigStatus;
  twitter: TwitterConfigStatus;
}
