import NextAuth, { type DefaultSession } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "./auth.config";

export type UserType = "guest" | "regular";

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      type: UserType;
      tenantId?: string;
      tenantName?: string;
      accessToken?: string;
    } & DefaultSession["user"];
  }

  interface User {
    email?: string | null;
    id?: string;
    type: UserType;
    tenantId?: string;
    tenantName?: string;
    accessToken?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
    type: UserType;
    tenantId?: string;
    tenantName?: string;
    accessToken?: string;
  }
}

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut,
} = NextAuth({
  ...authConfig,
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.type = user.type;
        token.tenantId = user.tenantId;
        token.tenantName = user.tenantName;
        token.accessToken = user.accessToken;
      }

      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.type = token.type;
        session.user.tenantId = token.tenantId;
        session.user.tenantName = token.tenantName;
        session.user.accessToken = token.accessToken;
      }

      return session;
    },
  },
  providers: [
    Credentials({
      async authorize(credentials) {
        const username = String(credentials.email ?? "");
        const password = String(credentials.password ?? "");
        
        try {
          const response = await fetch("http://docubot-backend:5001/api/v1/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password }),
          });

          if (!response.ok) {
            return null;
          }

          const data = await response.json();
          return {
            id: data.userId,
            name: data.username,
            email: `${data.username}@example.com`,
            type: "regular" as const,
            tenantId: data.tenantId,
            tenantName: data.tenantName,
            accessToken: data.accessToken,
          };
        } catch (error) {
          console.error("Auth error:", error);
          return null;
        }
      },
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
    }),
    Credentials({
      async authorize() {
        return {
          id: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
          name: "techuser",
          email: "techuser@example.com",
          type: "guest" as const,
          tenantId: "tenant-tech",
          tenantName: "TechSupport Corp",
          accessToken: "mock-guest-token",
        };
      },
      credentials: {},
      id: "guest",
    }),
  ],
});
