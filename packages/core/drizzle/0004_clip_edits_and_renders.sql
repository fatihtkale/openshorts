CREATE TABLE `renders` (
	`id` text PRIMARY KEY NOT NULL,
	`clip_id` text NOT NULL,
	`project_id` text NOT NULL,
	`status` text NOT NULL,
	`clip_version` integer NOT NULL,
	`storage_key` text,
	`bytes` integer,
	`duration_ms` integer,
	`error` text,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`clip_id`) REFERENCES `clips`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `renders_clip_idx` ON `renders` (`clip_id`);--> statement-breakpoint
CREATE INDEX `renders_project_idx` ON `renders` (`project_id`);--> statement-breakpoint
ALTER TABLE `clips` ADD `edit` text;--> statement-breakpoint
ALTER TABLE `clips` ADD `version` integer DEFAULT 1 NOT NULL;