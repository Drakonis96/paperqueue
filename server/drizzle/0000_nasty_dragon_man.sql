CREATE TABLE `papers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`zotero_key` text NOT NULL,
	`zotero_version` integer DEFAULT 0 NOT NULL,
	`library_id` text NOT NULL,
	`item_type` text DEFAULT 'journalArticle' NOT NULL,
	`title` text NOT NULL,
	`creators` text DEFAULT '[]' NOT NULL,
	`abstract` text,
	`publication_title` text,
	`publication_date` text,
	`doi` text,
	`url` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`pdf_attachment_key` text,
	`read_status` text DEFAULT 'unread' NOT NULL,
	`zotero_date_added` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `papers_library_zotero_key_idx` ON `papers` (`library_id`,`zotero_key`);--> statement-breakpoint
CREATE INDEX `papers_read_status_idx` ON `papers` (`read_status`);--> statement-breakpoint
CREATE TABLE `queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`paper_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`priority` real DEFAULT 0 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`postponed_until` integer,
	`added_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `queue_paper_id_idx` ON `queue` (`paper_id`);--> statement-breakpoint
CREATE INDEX `queue_status_priority_idx` ON `queue` (`status`,`priority`);--> statement-breakpoint
CREATE TABLE `reading_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`paper_id` integer NOT NULL,
	`started_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`ended_at` integer,
	`duration_seconds` integer DEFAULT 0 NOT NULL,
	`last_page` integer,
	`total_pages` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reading_sessions_paper_id_idx` ON `reading_sessions` (`paper_id`);--> statement-breakpoint
CREATE INDEX `reading_sessions_started_at_idx` ON `reading_sessions` (`started_at`);