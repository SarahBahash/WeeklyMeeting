-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CLOSED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "StageStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('DRAFT', 'FINALIZED');

-- CreateEnum
CREATE TYPE "ReviewState" AS ENUM ('PENDING', 'REVIEWED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ChangeSource" AS ENUM ('IMPORT', 'FORM', 'QUICK_EDIT', 'MEETING', 'ADMIN_CORRECTION', 'HISTORICAL_MERGE');

-- CreateEnum
CREATE TYPE "DeadlineChangeKind" AS ENUM ('REVISION', 'ORIGINAL_CORRECTION');

-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('MAIN_TRACKER', 'HISTORICAL', 'STAGE_TEMPLATE');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PREVIEW', 'COMMITTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LegacyDecision" AS ENUM ('PENDING', 'RETAIN', 'MERGE', 'SKIP');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "canOrganizeMeetings" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "oidcSubject" TEXT,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "supportsStages" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "activity_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isAudit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_stage_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sourceNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_stage_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_stage_template_stages" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "partNumber" INTEGER NOT NULL,
    "partName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "audit_stage_template_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_stages" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "partName" TEXT,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "ownerName" TEXT,
    "status" "StageStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "targetDate" DATE,
    "actualCompletionDate" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_points" (
    "id" TEXT NOT NULL,
    "legacySn" TEXT,
    "title" TEXT NOT NULL,
    "activityTypeId" TEXT,
    "projectId" TEXT,
    "projectStageId" TEXT,
    "currentStage" TEXT,
    "ownerName" TEXT,
    "originalTargetDate" DATE,
    "originalTargetText" TEXT,
    "revisedTargetDate" DATE,
    "revisedTargetText" TEXT,
    "priority" "Priority",
    "status" "ActionStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "feedback" TEXT,
    "nextAction" TEXT,
    "blocker" TEXT,
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "sourceStatus" TEXT,
    "sourceDelays" TEXT,
    "sourcePriority" TEXT,
    "sourceTargetRaw" TEXT,
    "sourceRevisedRaw" TEXT,
    "sourceSheet" TEXT,
    "sourceRow" INTEGER,
    "importKey" TEXT,
    "importBatchId" TEXT,
    "clientRequestId" TEXT,
    "createdInMeetingId" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "action_point_changes" (
    "id" TEXT NOT NULL,
    "actionPointId" TEXT NOT NULL,
    "changeGroupId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "source" "ChangeSource" NOT NULL,
    "meetingId" TEXT,
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_point_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deadline_changes" (
    "id" TEXT NOT NULL,
    "actionPointId" TEXT NOT NULL,
    "kind" "DeadlineChangeKind" NOT NULL,
    "previousDate" DATE,
    "previousText" TEXT,
    "newDate" DATE,
    "newText" TEXT,
    "reason" TEXT,
    "meetingId" TEXT,
    "changedById" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deadline_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meetings" (
    "id" TEXT NOT NULL,
    "meetingDate" DATE NOT NULL,
    "status" "MeetingStatus" NOT NULL DEFAULT 'DRAFT',
    "organizerId" TEXT NOT NULL,
    "attendees" TEXT,
    "notes" TEXT,
    "summary" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizedAt" TIMESTAMP(3),
    "finalizedById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_agenda_items" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "actionPointId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "reviewState" "ReviewState" NOT NULL DEFAULT 'PENDING',
    "snapshot" JSONB NOT NULL,
    "finalSnapshot" JSONB,
    "addedDuringMeeting" BOOLEAN NOT NULL DEFAULT false,
    "isNewAction" BOOLEAN NOT NULL DEFAULT false,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,

    CONSTRAINT "meeting_agenda_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_updates" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "agendaItemId" TEXT NOT NULL,
    "actionPointId" TEXT NOT NULL,
    "feedback" TEXT,
    "nextAction" TEXT,
    "blocker" TEXT,
    "changes" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_revisions" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "kind" "ImportKind" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PREVIEW',
    "fileName" TEXT NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "sheetName" TEXT NOT NULL,
    "preview" JSONB NOT NULL,
    "summary" JSONB,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legacy_history_records" (
    "id" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "importKey" TEXT NOT NULL,
    "sourceSheet" TEXT NOT NULL,
    "sourceRow" INTEGER NOT NULL,
    "actionText" TEXT,
    "projectText" TEXT,
    "ownerText" TEXT,
    "meetingDateRaw" TEXT,
    "meetingDate" DATE,
    "targetDateRaw" TEXT,
    "revisedDateRaw" TEXT,
    "statusRaw" TEXT,
    "feedback" TEXT,
    "decision" "LegacyDecision" NOT NULL DEFAULT 'PENDING',
    "linkedActionPointId" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "legacy_history_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "fileName" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "details" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_oidcSubject_key" ON "users"("oidcSubject");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "activity_types_code_key" ON "activity_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "projects_name_key" ON "projects"("name");

-- CreateIndex
CREATE UNIQUE INDEX "audit_stage_templates_name_key" ON "audit_stage_templates"("name");

-- CreateIndex
CREATE INDEX "audit_stage_template_stages_templateId_sortOrder_idx" ON "audit_stage_template_stages"("templateId", "sortOrder");

-- CreateIndex
CREATE INDEX "project_stages_projectId_sortOrder_idx" ON "project_stages"("projectId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "action_points_importKey_key" ON "action_points"("importKey");

-- CreateIndex
CREATE UNIQUE INDEX "action_points_clientRequestId_key" ON "action_points"("clientRequestId");

-- CreateIndex
CREATE INDEX "action_points_status_idx" ON "action_points"("status");

-- CreateIndex
CREATE INDEX "action_points_projectId_idx" ON "action_points"("projectId");

-- CreateIndex
CREATE INDEX "action_points_ownerName_idx" ON "action_points"("ownerName");

-- CreateIndex
CREATE INDEX "action_points_sortOrder_idx" ON "action_points"("sortOrder");

-- CreateIndex
CREATE INDEX "action_point_changes_actionPointId_changedAt_idx" ON "action_point_changes"("actionPointId", "changedAt");

-- CreateIndex
CREATE INDEX "action_point_changes_meetingId_idx" ON "action_point_changes"("meetingId");

-- CreateIndex
CREATE INDEX "deadline_changes_actionPointId_changedAt_idx" ON "deadline_changes"("actionPointId", "changedAt");

-- CreateIndex
CREATE UNIQUE INDEX "meetings_meetingDate_key" ON "meetings"("meetingDate");

-- CreateIndex
CREATE INDEX "meetings_status_idx" ON "meetings"("status");

-- CreateIndex
CREATE INDEX "meeting_agenda_items_meetingId_position_idx" ON "meeting_agenda_items"("meetingId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_agenda_items_meetingId_actionPointId_key" ON "meeting_agenda_items"("meetingId", "actionPointId");

-- CreateIndex
CREATE INDEX "meeting_updates_meetingId_idx" ON "meeting_updates"("meetingId");

-- CreateIndex
CREATE INDEX "meeting_updates_actionPointId_createdAt_idx" ON "meeting_updates"("actionPointId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_revisions_meetingId_revisionNumber_key" ON "meeting_revisions"("meetingId", "revisionNumber");

-- CreateIndex
CREATE INDEX "import_batches_fileSha256_sheetName_kind_idx" ON "import_batches"("fileSha256", "sheetName", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "legacy_history_records_importKey_key" ON "legacy_history_records"("importKey");

-- CreateIndex
CREATE INDEX "legacy_history_records_linkedActionPointId_idx" ON "legacy_history_records"("linkedActionPointId");

-- CreateIndex
CREATE INDEX "export_logs_createdAt_idx" ON "export_logs"("createdAt");

-- CreateIndex
CREATE INDEX "system_audit_logs_createdAt_idx" ON "system_audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "system_audit_logs_action_idx" ON "system_audit_logs"("action");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_stage_template_stages" ADD CONSTRAINT "audit_stage_template_stages_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "audit_stage_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_stages" ADD CONSTRAINT "project_stages_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_points" ADD CONSTRAINT "action_points_activityTypeId_fkey" FOREIGN KEY ("activityTypeId") REFERENCES "activity_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_points" ADD CONSTRAINT "action_points_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_points" ADD CONSTRAINT "action_points_projectStageId_fkey" FOREIGN KEY ("projectStageId") REFERENCES "project_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_points" ADD CONSTRAINT "action_points_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_points" ADD CONSTRAINT "action_points_createdInMeetingId_fkey" FOREIGN KEY ("createdInMeetingId") REFERENCES "meetings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_points" ADD CONSTRAINT "action_points_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_points" ADD CONSTRAINT "action_points_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_point_changes" ADD CONSTRAINT "action_point_changes_actionPointId_fkey" FOREIGN KEY ("actionPointId") REFERENCES "action_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_point_changes" ADD CONSTRAINT "action_point_changes_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "action_point_changes" ADD CONSTRAINT "action_point_changes_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deadline_changes" ADD CONSTRAINT "deadline_changes_actionPointId_fkey" FOREIGN KEY ("actionPointId") REFERENCES "action_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deadline_changes" ADD CONSTRAINT "deadline_changes_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deadline_changes" ADD CONSTRAINT "deadline_changes_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_agenda_items" ADD CONSTRAINT "meeting_agenda_items_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_agenda_items" ADD CONSTRAINT "meeting_agenda_items_actionPointId_fkey" FOREIGN KEY ("actionPointId") REFERENCES "action_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_updates" ADD CONSTRAINT "meeting_updates_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_updates" ADD CONSTRAINT "meeting_updates_agendaItemId_fkey" FOREIGN KEY ("agendaItemId") REFERENCES "meeting_agenda_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_updates" ADD CONSTRAINT "meeting_updates_actionPointId_fkey" FOREIGN KEY ("actionPointId") REFERENCES "action_points"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_updates" ADD CONSTRAINT "meeting_updates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_revisions" ADD CONSTRAINT "meeting_revisions_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_revisions" ADD CONSTRAINT "meeting_revisions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legacy_history_records" ADD CONSTRAINT "legacy_history_records_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "import_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "legacy_history_records" ADD CONSTRAINT "legacy_history_records_linkedActionPointId_fkey" FOREIGN KEY ("linkedActionPointId") REFERENCES "action_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_logs" ADD CONSTRAINT "export_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
