import crypto from "node:crypto";
import type { LinkedInAccountRecord } from "./types.js";

export class LinkedInApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 500,
    readonly errorCode?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "LinkedInApiError";
  }
}

export class LinkedInAuthError extends LinkedInApiError {
  constructor(message: string, details?: unknown) {
    super(message, 401, "UNAUTHORIZED", details);
    this.name = "LinkedInAuthError";
  }
}

export class LinkedInScopeError extends LinkedInApiError {
  constructor(message: string, details?: unknown) {
    super(message, 403, "INSUFFICIENT_SCOPE", details);
    this.name = "LinkedInScopeError";
  }
}

export class LinkedInRateLimitError extends LinkedInApiError {
  constructor(message: string, details?: unknown) {
    super(message, 429, "RATE_LIMITED", details);
    this.name = "LinkedInRateLimitError";
  }
}

export interface LinkedInClientOptions {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  version?: string;
  fetchFn?: typeof fetch;
}

export interface LinkedInCreatePostParams {
  authorUrn: string;
  commentary: string;
  imageUrn?: string;
  visibility?: "PUBLIC" | "CONNECTIONS";
}

export interface LinkedInPostResult {
  postId: string;
  permalink: string;
  publishedAt: string;
}

export class LinkedInClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly version: string;
  private readonly fetch: typeof fetch;

  constructor(options?: LinkedInClientOptions) {
    const env = process.env;
    this.clientId = (options?.clientId || env.LINKEDIN_CLIENT_ID || "").trim();
    this.clientSecret = (options?.clientSecret || env.LINKEDIN_CLIENT_SECRET || "").trim();
    this.redirectUri = (
      options?.redirectUri ||
      env.LINKEDIN_REDIRECT_URI ||
      "http://localhost:3001/api/social/linkedin/callback"
    ).trim();
    this.version = options?.version || "202401";
    this.fetch = options?.fetchFn || globalThis.fetch.bind(globalThis);
  }

  get isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  /**
   * Generates a cryptographically secure CSRF state and constructs the OAuth authorization URL.
   */
  getAuthorizationUrl(redirectUri?: string, state?: string): { url: string; state: string } {
    if (!this.clientId) {
      throw new LinkedInApiError(
        "LinkedIn Client ID is missing. Set LINKEDIN_CLIENT_ID in server environment.",
        500,
        "CONFIG_MISSING",
      );
    }

    const csrfState = state || crypto.randomBytes(24).toString("hex");
    const targetRedirect = redirectUri || this.redirectUri;
    const scopes = "openid profile email w_member_social";

    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.clientId,
      redirect_uri: targetRedirect,
      state: csrfState,
      scope: scopes,
    });

    const url = `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
    return { url, state: csrfState };
  }

  /**
   * Exchanges authorization code for an OAuth 2.0 access token.
   */
  async exchangeAuthorizationCode(
    code: string,
    redirectUri?: string,
  ): Promise<{ accessToken: string; expiresIn: number; scopes: string[] }> {
    if (!this.clientId || !this.clientSecret) {
      throw new LinkedInApiError(
        "LinkedIn credentials missing. Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET in server environment.",
        500,
        "CONFIG_MISSING",
      );
    }

    const targetRedirect = redirectUri || this.redirectUri;
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: targetRedirect,
    });

    const response = await this.fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errText = await response.text();
      let parsed: any;
      try {
        parsed = JSON.parse(errText);
      } catch {
        parsed = { error: errText };
      }

      if (response.status === 401) {
        throw new LinkedInAuthError("Invalid LinkedIn authorization code or client secret.", parsed);
      }
      throw new LinkedInApiError(
        `Failed to exchange LinkedIn authorization code: ${parsed.error_description || parsed.error || response.statusText}`,
        response.status,
        parsed.error || "OAUTH_EXCHANGE_FAILED",
        parsed,
      );
    }

    const data = await response.json();
    const accessToken = data.access_token;
    const expiresIn = Number(data.expires_in) || 5184000; // ~60 days default
    const scopeString = data.scope || "";
    const scopes = scopeString
      .split(/[, ]+/)
      .map((s: string) => s.trim())
      .filter(Boolean);

    return { accessToken, expiresIn, scopes };
  }

  /**
   * Retrieves the authenticated member's OpenID Connect profile and constructs author Person URN.
   */
  async getMemberProfile(accessToken: string): Promise<LinkedInAccountRecord> {
    const response = await this.fetch("https://api.linkedin.com/v2/userinfo", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      if (response.status === 401) {
        throw new LinkedInAuthError("LinkedIn access token is invalid or expired.", { raw: errText });
      }
      throw new LinkedInApiError(`Failed to fetch LinkedIn profile: ${response.statusText}`, response.status, "PROFILE_FETCH_FAILED");
    }

    const data = await response.json();
    const sub = data.sub;
    if (!sub) {
      throw new LinkedInApiError("LinkedIn userinfo response missing subject identifier (sub).", 502, "INVALID_PROFILE_DATA");
    }

    const memberUrn = `urn:li:person:${sub}`;
    const name = data.name || [data.given_name, data.family_name].filter(Boolean).join(" ") || "LinkedIn Member";
    const email = data.email;
    const pictureUrl = data.picture;

    return {
      memberUrn,
      name,
      email,
      pictureUrl,
      accessToken,
      expiresAt: Date.now() + 5184000 * 1000,
      scopes: ["openid", "profile", "email", "w_member_social"],
      connectedAt: new Date().toISOString(),
    };
  }

  /**
   * Step 1 of Image Upload: Initialize upload with LinkedIn Images API.
   * POST /rest/images?action=initializeUpload
   */
  async initializeImageUpload(
    accessToken: string,
    ownerUrn: string,
  ): Promise<{ uploadUrl: string; imageUrn: string }> {
    const response = await this.fetch("https://api.linkedin.com/rest/images?action=initializeUpload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "LinkedIn-Version": this.version,
        "X-Restli-Protocol-Version": "2.0.0",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        initializeUploadRequest: {
          owner: ownerUrn,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      let parsed: any;
      try {
        parsed = JSON.parse(errText);
      } catch {
        parsed = { error: errText };
      }

      this.handleCommonErrors(response.status, parsed);
      throw new LinkedInApiError(
        `Failed to initialize LinkedIn image upload: ${parsed.message || response.statusText}`,
        response.status,
        "IMAGE_INIT_FAILED",
        parsed,
      );
    }

    const data = await response.json();
    const value = data.value;
    if (!value?.uploadUrl || !value?.image) {
      throw new LinkedInApiError("LinkedIn initializeUpload response missing uploadUrl or image URN.", 502, "MALFORMED_IMAGE_INIT");
    }

    return {
      uploadUrl: value.uploadUrl,
      imageUrn: value.image,
    };
  }

  /**
   * Step 2 of Image Upload: Upload binary image data to the initialized uploadUrl.
   * PUT {uploadUrl}
   */
  async uploadImageBinary(
    uploadUrl: string,
    accessToken: string,
    imageBuffer: Buffer,
    mimeType: string = "image/png",
  ): Promise<void> {
    const response = await this.fetch(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": mimeType,
      },
      body: new Uint8Array(imageBuffer),
    });

    if (!response.ok && response.status !== 200 && response.status !== 201) {
      const errText = await response.text();
      throw new LinkedInApiError(
        `Failed to upload image binary to LinkedIn: HTTP ${response.status}`,
        response.status,
        "IMAGE_BINARY_UPLOAD_FAILED",
        { raw: errText },
      );
    }
  }

  /**
   * Step 3: Create a post with commentary and optional media asset.
   * POST /rest/posts
   */
  async createPost(
    accessToken: string,
    params: LinkedInCreatePostParams,
  ): Promise<LinkedInPostResult> {
    if (!params.authorUrn) {
      throw new LinkedInApiError("LinkedIn author URN is required.", 400, "MISSING_AUTHOR_URN");
    }

    if (!params.commentary || !params.commentary.trim()) {
      throw new LinkedInApiError("LinkedIn commentary text cannot be empty.", 400, "EMPTY_COMMENTARY");
    }

    const payload: any = {
      author: params.authorUrn,
      commentary: params.commentary,
      visibility: params.visibility || "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    };

    if (params.imageUrn) {
      payload.content = {
        media: {
          id: params.imageUrn,
        },
      };
    }

    const response = await this.fetch("https://api.linkedin.com/rest/posts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "LinkedIn-Version": this.version,
        "X-Restli-Protocol-Version": "2.0.0",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok && response.status !== 201) {
      const errText = await response.text();
      let parsed: any;
      try {
        parsed = JSON.parse(errText);
      } catch {
        parsed = { error: errText };
      }

      this.handleCommonErrors(response.status, parsed);
      throw new LinkedInApiError(
        `LinkedIn post creation failed: ${parsed.message || response.statusText}`,
        response.status,
        "POST_CREATION_FAILED",
        parsed,
      );
    }

    // LinkedIn returns the post URN in the x-restli-id response header
    const restliId =
      response.headers.get("x-restli-id") ||
      response.headers.get("x-linkedin-id") ||
      "";

    if (!restliId) {
      // Best-effort check if body contains id
      const text = await response.text();
      let jsonId: string | undefined;
      try {
        const bodyData = JSON.parse(text);
        jsonId = bodyData.id || bodyData.urn;
      } catch {}

      const effectiveId = jsonId || `urn:li:post:unknown_${Date.now()}`;
      return {
        postId: effectiveId,
        permalink: `https://www.linkedin.com/feed/update/${effectiveId}/`,
        publishedAt: new Date().toISOString(),
      };
    }

    const permalink = `https://www.linkedin.com/feed/update/${restliId}/`;
    return {
      postId: restliId,
      permalink,
      publishedAt: new Date().toISOString(),
    };
  }

  private handleCommonErrors(statusCode: number, parsed: any): void {
    if (statusCode === 401) {
      throw new LinkedInAuthError(
        "LinkedIn access token is invalid or expired. Re-authenticate with LinkedIn.",
        parsed,
      );
    }
    if (statusCode === 403) {
      throw new LinkedInScopeError(
        "LinkedIn token lacks w_member_social permission. Verify your LinkedIn Developer app permissions and re-authenticate.",
        parsed,
      );
    }
    if (statusCode === 429) {
      throw new LinkedInRateLimitError(
        "LinkedIn API rate limit exceeded. Please wait before retrying.",
        parsed,
      );
    }
  }
}
