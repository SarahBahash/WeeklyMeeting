"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CalendarCheck2, ListChecks, PlayCircle } from "lucide-react";
import { api, ApiClientError } from "@/lib/client";
import { formatDate } from "@/lib/dates";
import { useAuth } from "@/components/auth-context";
import { useLoad, useMeta } from "@/components/hooks";
import { Alert, Button, Card, Field, PageHeader, Spinner } from "@/components/ui";

export function StartMeeting() {
  const { user, can } = useAuth();
  const router = useRouter();
  const { meta } = useMeta();
  const summary = useLoad<{ inProgress: number }>("/api/dashboard");
  const recent = useLoad<{ meetings: { id: string; meetingDate: string; status: string; agendaItems: number; reviewed: number }[] }>("/api/meetings");
  const [date, setDate] = useState("");
  const [attendees, setAttendees] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<{ message: string; existing?: string } | null>(null);
  const [starting, setStarting] = useState(false);
  useEffect(() => { if (meta && !date) setDate(meta.today); }, [meta, date]);

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const res = await api<{ meetingId: string }>("/api/meetings", { body: { meetingDate: date, attendees, notes } });
      router.push(`/meetings/${res.meetingId}/run`);
    } catch (e) {
      setError({ message: (e as Error).message, existing: e instanceof ApiClientError ? (e.data.existingMeetingId as string | undefined) : undefined });
      setStarting(false);
    }
  }

  if (!meta) return <Spinner />;
  const draft = meta.draftMeeting;
  const draftInfo = draft ? recent.data?.meetings.find((m) => m.id === draft.id) : null;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Sunday Meeting" description="Review every In Progress action point, record updates and produce the meeting summary." />
      {draft ? (
        <Card className="p-6">
          <div className="flex items-start gap-4">
            <div className="rounded-lg bg-brand-light p-3 text-brand"><CalendarCheck2 className="h-6 w-6" /></div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold">Draft meeting – {formatDate(draft.meetingDate)}</h2>
              <p className="mt-1 text-sm text-muted">
                This meeting was saved as a draft{draftInfo ? ` · reviewed ${draftInfo.reviewed} of ${draftInfo.agendaItems} items` : ""}. Resume to continue where you left off.
              </p>
              <div className="mt-4"><Link href={`/meetings/${draft.id}/run`}><Button variant="primary" size="lg" icon={<PlayCircle className="h-5 w-5" />}>Resume meeting</Button></Link></div>
            </div>
          </div>
        </Card>
      ) : can("meeting:organize") ? (
        <Card className="p-6">
          <h2 className="text-lg font-semibold">Start a new meeting</h2>
          <p className="mt-1 text-sm text-muted">
            {summary.data ? <><strong className="text-navy">{summary.data.inProgress}</strong> action point(s) with status In Progress will be loaded into the agenda in tracker order – audit reviews, management meetings and general tasks alike.</> : "Loading agenda size…"}
          </p>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <Field label="Meeting date" htmlFor="m-date" hint="Suggested: today in Asia/Riyadh.">
              <input id="m-date" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Organizer"><input className="input" value={user.name} disabled /></Field>
            <Field label="Attendees (optional)" htmlFor="m-att" className="md:col-span-2">
              <textarea id="m-att" className="input min-h-[70px]" placeholder="e.g. Head of IA, Senior Auditor, Auditor" value={attendees} onChange={(e) => setAttendees(e.target.value)} maxLength={2000} />
            </Field>
            <Field label="Notes (optional)" htmlFor="m-notes" className="md:col-span-2">
              <input id="m-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} />
            </Field>
          </div>
          {error && (
            <div className="mt-4"><Alert>{error.message}{error.existing && <> <Link className="link font-medium" href={`/meetings/${error.existing}`}>Open that meeting</Link></>}</Alert></div>
          )}
          <div className="mt-5 flex items-center gap-3">
            <Button variant="primary" size="lg" loading={starting} disabled={!date} onClick={start} icon={<PlayCircle className="h-5 w-5" />}>Start meeting</Button>
            <span className="text-xs text-muted">A snapshot of every agenda item is saved before the review begins.</span>
          </div>
        </Card>
      ) : (
        <Alert tone="info">No meeting is in progress. Only meeting organizers can start a new meeting.</Alert>
      )}
      <div className="mt-8">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><ListChecks className="h-4 w-4" /> Recent meetings</h3>
        {recent.data?.meetings.length ? (
          <Card>
            <ul className="divide-y divide-line">
              {recent.data.meetings.slice(0, 5).map((m) => (
                <li key={m.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <Link className="link font-medium" href={`/meetings/${m.id}`}>{formatDate(m.meetingDate)}</Link>
                  <span className="text-muted">{m.reviewed} of {m.agendaItems} reviewed · {m.status === "DRAFT" ? "Draft" : "Finalized"}</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : <p className="text-sm text-muted">No meetings recorded yet.</p>}
      </div>
    </div>
  );
}
