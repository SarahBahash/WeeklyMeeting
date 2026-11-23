// Local mock OIDC identity provider for testing the SSO flow (never used in production).
import { OAuth2Server } from "oauth2-mock-server";
const server = new OAuth2Server();
await server.issuer.keys.generate("RS256");
const email = process.env.MOCK_EMAIL ?? "admin@example.test";
const amr = (process.env.MOCK_AMR ?? "pwd,mfa").split(",");
server.service.on("beforeTokenSigning", (token) => {
  token.payload.sub = "mock-sub-" + email;
  token.payload.email = email;
  token.payload.email_verified = true;
  token.payload.amr = amr;
});
await server.start(9400, "localhost");
console.log("mock IdP", server.issuer.url);
