-- History and audit tables are append-only at the database level.
-- Ordinary application code (and ordinary users) cannot rewrite or delete them.
CREATE OR REPLACE FUNCTION iahub_prevent_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER system_audit_logs_append_only BEFORE UPDATE OR DELETE ON "system_audit_logs"
  FOR EACH ROW EXECUTE FUNCTION iahub_prevent_modification();
CREATE TRIGGER action_point_changes_append_only BEFORE UPDATE OR DELETE ON "action_point_changes"
  FOR EACH ROW EXECUTE FUNCTION iahub_prevent_modification();
CREATE TRIGGER deadline_changes_append_only BEFORE UPDATE OR DELETE ON "deadline_changes"
  FOR EACH ROW EXECUTE FUNCTION iahub_prevent_modification();
CREATE TRIGGER meeting_updates_append_only BEFORE UPDATE OR DELETE ON "meeting_updates"
  FOR EACH ROW EXECUTE FUNCTION iahub_prevent_modification();
CREATE TRIGGER meeting_revisions_append_only BEFORE UPDATE OR DELETE ON "meeting_revisions"
  FOR EACH ROW EXECUTE FUNCTION iahub_prevent_modification();
CREATE TRIGGER export_logs_append_only BEFORE UPDATE OR DELETE ON "export_logs"
  FOR EACH ROW EXECUTE FUNCTION iahub_prevent_modification();

-- Action points are never hard-deleted (completed/closed items stay in reports).
CREATE TRIGGER action_points_no_delete BEFORE DELETE ON "action_points"
  FOR EACH ROW EXECUTE FUNCTION iahub_prevent_modification();

-- Finalized meetings: agenda snapshots are immutable.
CREATE OR REPLACE FUNCTION iahub_protect_finalized_agenda() RETURNS trigger AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM "meetings" WHERE id = COALESCE(OLD."meetingId", NEW."meetingId");
  IF st = 'FINALIZED' THEN
    RAISE EXCEPTION 'Agenda of a finalized meeting cannot be modified' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.snapshot IS DISTINCT FROM OLD.snapshot THEN
    RAISE EXCEPTION 'Agenda snapshot is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER meeting_agenda_protect BEFORE UPDATE OR DELETE ON "meeting_agenda_items"
  FOR EACH ROW EXECUTE FUNCTION iahub_protect_finalized_agenda();

-- A finalized meeting's summary/date/organizer cannot be rewritten (corrections go to meeting_revisions).
CREATE OR REPLACE FUNCTION iahub_protect_finalized_meeting() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Meetings cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'FINALIZED' AND (
       NEW.summary IS DISTINCT FROM OLD.summary OR NEW."meetingDate" IS DISTINCT FROM OLD."meetingDate"
    OR NEW."organizerId" IS DISTINCT FROM OLD."organizerId" OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.attendees IS DISTINCT FROM OLD.attendees OR NEW.notes IS DISTINCT FROM OLD.notes) THEN
    RAISE EXCEPTION 'Finalized meeting is immutable; record a revision instead' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER meetings_protect BEFORE UPDATE OR DELETE ON "meetings"
  FOR EACH ROW EXECUTE FUNCTION iahub_protect_finalized_meeting();
