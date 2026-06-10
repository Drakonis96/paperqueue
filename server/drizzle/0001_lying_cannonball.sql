CREATE TABLE `account` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`zotero_user_id` text NOT NULL,
	`username` text,
	`api_key` text NOT NULL,
	`library_id` text NOT NULL,
	`session_token` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
