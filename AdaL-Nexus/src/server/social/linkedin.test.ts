import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  LinkedInApiError,
  LinkedInAuthError,
  LinkedInClient,
  LinkedInRateLimitError,
  LinkedInScopeError,
} from "./linkedinClient.js";
import { SocialPublishingService } from "./socialPublishingService.js";
import { SocialStore } from "./socialStore.js";

/**
 * Phase 3.2: Mocked LinkedIn Official API Tests
 *
 * NOTE: These tests use simulated HTTP mock responses to verify client request construction,
 * OAuth flows, image upload sequencing, response parsing, error categorization, and approval gates.
 * They do NOT make outbound network calls to live LinkedIn servers.
 */
describe("Phase 3.2: Mocked LinkedIn Official API Tests (Isolated Offline Suite)", () => {
  let tempDir: string;
  let testStore: SocialStore;

  before(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "adal-linkedin-test-"));
    testStore = new SocialStore(path.join(tempDir, "store"));
  });

  after(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe("LinkedInClient OAuth 2.0 Authorization Flow (Mocked)", () => {
    it("constructs secure OAuth authorization URL with CSRF state and required scopes", () => {
      const client = new LinkedInClient({
        clientId: "test_client_id_123",
        clientSecret: "test_client_secret_456",
        redirectUri: "http://localhost:3001/api/social/linkedin/callback",
      });

      const { url, state } = client.getAuthorizationUrl();
      assert.ok(url.startsWith("https://www.linkedin.com/oauth/v2/authorization?"));
      assert.ok(state.length >= 32);

      const parsedUrl = new URL(url);
      assert.equal(parsedUrl.searchParams.get("response_type"), "code");
      assert.equal(parsedUrl.searchParams.get("client_id"), "test_client_id_123");
      assert.equal(parsedUrl.searchParams.get("redirect_uri"), "http://localhost:3001/api/social/linkedin/callback");
      assert.equal(parsedUrl.searchParams.get("state"), state);
      assert.ok(parsedUrl.searchParams.get("scope")?.includes("w_member_social"));
      assert.ok(parsedUrl.searchParams.get("scope")?.includes("openid"));
    });

    it("exchanges authorization code for access token via mocked fetch", async () => {
      let capturedUrl = "";
      let capturedBody = "";

      const mockFetch: typeof fetch = async (input, init) => {
        capturedUrl = input.toString();
        capturedBody = init?.body?.toString() || "";
        return new Response(
          JSON.stringify({
            access_token: "mock_token_abc_123",
            expires_in: 5184000,
            scope: "openid profile email w_member_social",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      };

      const client = new LinkedInClient({
        clientId: "test_client_123",
        clientSecret: "test_secret_456",
        fetchFn: mockFetch,
      });

      const result = await client.exchangeAuthorizationCode("test_auth_code_xyz");
      assert.equal(capturedUrl, "https://www.linkedin.com/oauth/v2/accessToken");
      assert.ok(capturedBody.includes("grant_type=authorization_code"));
      assert.ok(capturedBody.includes("code=test_auth_code_xyz"));
      assert.equal(result.accessToken, "mock_token_abc_123");
      assert.ok(result.scopes.includes("w_member_social"));
    });

    it("handles 401 unauthorized on invalid code as LinkedInAuthError", async () => {
      const mockFetch: typeof fetch = async () => {
        return new Response(JSON.stringify({ error: "invalid_grant", error_description: "Code expired" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      };

      const client = new LinkedInClient({
        clientId: "test_client_123",
        clientSecret: "test_secret_456",
        fetchFn: mockFetch,
      });

      await assert.rejects(
        () => client.exchangeAuthorizationCode("invalid_code"),
        (err: any) => err instanceof LinkedInAuthError,
      );
    });

    it("retrieves member profile and maps OpenID sub to Person URN", async () => {
      const mockFetch: typeof fetch = async (input, init) => {
        assert.equal(init?.headers?.["Authorization" as keyof typeof init.headers], "Bearer test_bearer_token");
        return new Response(
          JSON.stringify({
            sub: "member_778899",
            name: "Ada Lovelace",
            email: "ada@example.com",
            picture: "https://media.licdn.com/mock_avatar.jpg",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      };

      const client = new LinkedInClient({ fetchFn: mockFetch });
      const profile = await client.getMemberProfile("test_bearer_token");

      assert.equal(profile.memberUrn, "urn:li:person:member_778899");
      assert.equal(profile.name, "Ada Lovelace");
      assert.equal(profile.email, "ada@example.com");
      assert.equal(profile.pictureUrl, "https://media.licdn.com/mock_avatar.jpg");
    });
  });

  describe("LinkedIn Image Upload & Posts API Flow (Mocked)", () => {
    it("initializes image upload and returns uploadUrl and imageUrn", async () => {
      let capturedPayload: any = null;

      const mockFetch: typeof fetch = async (input, init) => {
        capturedPayload = JSON.parse(init?.body?.toString() || "{}");
        return new Response(
          JSON.stringify({
            value: {
              uploadUrl: "https://media.example.com/upload/binary_session_1",
              image: "urn:li:image:D4E10AQMockImage123",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      };

      const client = new LinkedInClient({ fetchFn: mockFetch });
      const result = await client.initializeImageUpload("test_token", "urn:li:person:member_123");

      assert.equal(capturedPayload.initializeUploadRequest?.owner, "urn:li:person:member_123");
      assert.equal(result.uploadUrl, "https://media.example.com/upload/binary_session_1");
      assert.equal(result.imageUrn, "urn:li:image:D4E10AQMockImage123");
    });

    it("uploads raw binary image data to the uploadUrl", async () => {
      let uploadedMethod = "";
      let uploadedMime = "";
      let uploadedLength = 0;

      const mockFetch: typeof fetch = async (input, init) => {
        uploadedMethod = init?.method || "";
        uploadedMime = (init?.headers as any)?.["Content-Type"] || "";
        uploadedLength = (init?.body as Buffer)?.length || 0;
        return new Response("", { status: 201 });
      };

      const client = new LinkedInClient({ fetchFn: mockFetch });
      const sampleBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      await client.uploadImageBinary("https://media.example.com/upload/binary_session_1", "test_token", sampleBuffer, "image/png");

      assert.equal(uploadedMethod, "PUT");
      assert.equal(uploadedMime, "image/png");
      assert.equal(uploadedLength, sampleBuffer.length);
    });

    it("creates post with commentary and image URN, extracting x-restli-id header", async () => {
      let postPayload: any = null;

      const mockFetch: typeof fetch = async (input, init) => {
        postPayload = JSON.parse(init?.body?.toString() || "{}");
        const headers = new Headers();
        headers.set("x-restli-id", "urn:li:share:7198234710293847561");
        return new Response("", {
          status: 201,
          headers,
        });
      };

      const client = new LinkedInClient({ fetchFn: mockFetch });
      const postResult = await client.createPost("test_token", {
        authorUrn: "urn:li:person:member_123",
        commentary: "Exciting milestone for autonomous systems! #AI #Tech",
        imageUrn: "urn:li:image:D4E10AQMockImage123",
        visibility: "PUBLIC",
      });

      assert.equal(postPayload.author, "urn:li:person:member_123");
      assert.equal(postPayload.commentary, "Exciting milestone for autonomous systems! #AI #Tech");
      assert.equal(postPayload.content?.media?.id, "urn:li:image:D4E10AQMockImage123");
      assert.equal(postResult.postId, "urn:li:share:7198234710293847561");
      assert.equal(postResult.permalink, "https://www.linkedin.com/feed/update/urn:li:share:7198234710293847561/");
    });

    it("maps 403 Forbidden to LinkedInScopeError when w_member_social is missing", async () => {
      const mockFetch: typeof fetch = async () => {
        return new Response(JSON.stringify({ status: 403, message: "Not enough permissions to post on behalf of member" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      };

      const client = new LinkedInClient({ fetchFn: mockFetch });
      await assert.rejects(
        () =>
          client.createPost("token_without_scope", {
            authorUrn: "urn:li:person:123",
            commentary: "Test",
          }),
        (err: any) => err instanceof LinkedInScopeError,
      );
    });

    it("maps 429 Too Many Requests to LinkedInRateLimitError", async () => {
      const mockFetch: typeof fetch = async () => {
        return new Response(JSON.stringify({ status: 429, message: "Throttle limit reached for member" }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        });
      };

      const client = new LinkedInClient({ fetchFn: mockFetch });
      await assert.rejects(
        () =>
          client.createPost("token", {
            authorUrn: "urn:li:person:123",
            commentary: "Test",
          }),
        (err: any) => err instanceof LinkedInRateLimitError,
      );
    });
  });

  describe("SocialPublishingService LinkedIn Integration (Mocked)", () => {
    it("enforces approval gate: rejects unapproved publishing requests before calling API", async () => {
      let apiCalled = false;
      const mockClient = new LinkedInClient({
        fetchFn: async () => {
          apiCalled = true;
          return new Response("", { status: 201 });
        },
      });

      const service = new SocialPublishingService({
        store: testStore,
        linkedInClient: mockClient,
      });

      await assert.rejects(
        () =>
          service.publishMultiPlatform({
            platforms: ["linkedin"],
            image: { fileName: "test.png", mimeType: "image/png", fileSize: 100 },
            captions: { linkedin: "Post text" },
            ownershipConfirmed: true,
            userApproved: false, // NOT approved
          }),
        /explicit user approval is required/i,
      );

      assert.equal(apiCalled, false, "Must never call publishing API if approval gate was not passed");
    });

    it("executes full LinkedIn image upload and post creation with mocked client when authenticated", async () => {
      const mockClient = new LinkedInClient({
        fetchFn: async (input, init) => {
          const url = input.toString();
          if (url.includes("action=initializeUpload")) {
            return new Response(
              JSON.stringify({
                value: {
                  uploadUrl: "https://upload.example.com/binary",
                  image: "urn:li:image:TEST_IMAGE_URN_99",
                },
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          if (url === "https://upload.example.com/binary") {
            return new Response("", { status: 201 });
          }
          if (url.includes("/rest/posts")) {
            const h = new Headers();
            h.set("x-restli-id", "urn:li:share:887766554433221100");
            return new Response("", { status: 201, headers: h });
          }
          return new Response("Not Found", { status: 404 });
        },
      });

      // Save a valid LinkedIn account in the test store
      await testStore.saveLinkedInAccount({
        memberUrn: "urn:li:person:member_ada",
        name: "Ada Lovelace",
        accessToken: "valid_test_token_123",
        expiresAt: Date.now() + 1000000,
        scopes: ["openid", "profile", "w_member_social"],
        connectedAt: new Date().toISOString(),
      });

      const service = new SocialPublishingService({
        store: testStore,
        linkedInClient: mockClient,
        publishingProvider: "api",
      });

      const pngBase64 = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64")}`;

      const res = await service.publishMultiPlatform({
        platforms: ["linkedin"],
        image: {
          fileName: "chart.png",
          mimeType: "image/png",
          fileSize: 8,
          base64Data: pngBase64,
        },
        captions: { linkedin: "Verified analysis via LinkedIn Posts API." },
        ownershipConfirmed: true,
        userApproved: true,
      });

      assert.equal(res.overallStatus, "completed");
      assert.equal(res.results.linkedin.status, "published");
      assert.equal(res.results.linkedin.postId, "urn:li:share:887766554433221100");
      assert.equal(res.results.linkedin.publishedUrl, "https://www.linkedin.com/feed/update/urn:li:share:887766554433221100/");
    });

    it("truthfully reports failure when unauthenticated and not in mock mode (no synthetic URLs)", async () => {
      // Clear any stored account
      await testStore.clearLinkedInAccount();
      const prevEnv = process.env.LINKEDIN_ACCESS_TOKEN;
      delete process.env.LINKEDIN_ACCESS_TOKEN;

      try {
        const service = new SocialPublishingService({
          store: testStore,
          publishingProvider: "api", // Explicitly live API mode
        });

        const res = await service.publishMultiPlatform({
          platforms: ["linkedin"],
          image: { fileName: "test.png", mimeType: "image/png", fileSize: 100 },
          captions: { linkedin: "Post text" },
          ownershipConfirmed: true,
          userApproved: true,
        });

        assert.equal(res.results.linkedin.status, "failed");
        assert.ok(res.results.linkedin.error?.includes("No active LinkedIn OAuth session"));
        assert.equal(res.results.linkedin.publishedUrl, undefined, "Must NOT fabricate a synthetic URL when unauthenticated");
      } finally {
        if (prevEnv) process.env.LINKEDIN_ACCESS_TOKEN = prevEnv;
      }
    });

    it("validates CSRF state parameter and prevents OAuth replay attacks", async () => {
      const state = "test_csrf_token_123456";
      await testStore.saveOAuthState(state, 5000);

      // First verification succeeds
      const firstValid = await testStore.verifyAndConsumeOAuthState(state);
      assert.equal(firstValid, true);

      // Replay attempt fails because state was consumed
      const replayValid = await testStore.verifyAndConsumeOAuthState(state);
      assert.equal(replayValid, false, "Replay attack must fail");
    });
  });
});
