import Link from "next/link";
import { ShieldAlert } from "lucide-react";

export default function Forbidden() {
  return (
    <div className="mx-auto mt-24 max-w-md text-center">
      <ShieldAlert className="mx-auto h-10 w-10 text-danger" aria-hidden />
      <h1 className="mt-3 text-xl font-semibold">Access restricted</h1>
      <p className="mt-2 text-sm text-muted">Your role does not include access to this section. Contact an administrator if you need access.</p>
      <Link href="/" className="link mt-4 inline-block text-sm">Back to dashboard</Link>
    </div>
  );
}
