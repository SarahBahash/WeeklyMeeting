"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field } from "@/components/ui";
import { api, ApiClientError } from "@/lib/client";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api("/api/auth/login", { body: { email, password } });
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Sign-in failed");
      setLoading(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <Field label="Email" htmlFor="email"><input id="email" type="email" autoComplete="username" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
      <Field label="Password" htmlFor="password"><input id="password" type="password" autoComplete="current-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      <Button type="submit" variant="secondary" className="w-full" loading={loading}>Sign in (development)</Button>
    </form>
  );
}
