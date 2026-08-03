import { createAuthClient } from "better-auth/react";
import { emailOTPClient, organizationClient } from "better-auth/client/plugins";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3333";

export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [organizationClient(), emailOTPClient()],
  fetchOptions: { credentials: "include" },
});

export const { signIn, signUp, signOut, useSession, organization, useListOrganizations, useActiveOrganization } =
  authClient;
