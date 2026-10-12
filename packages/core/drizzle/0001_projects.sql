CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`storage_key` text NOT NULL,
	`bytes` integer NOT NULL,
	`mime_type` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assets_project_kind_idx` ON `assets` (`project_id`,`kind`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`source_type` text NOT NULL,
	`source_url` text,
	`source_id` text,
	`source_meta` text,
	`status` text NOT NULL,
	`error` text,
	`duration_ms` integer,
	`width` integer,
	`height` integer,
	`fps` real,
	`has_audio` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `projects_deleted_at_idx` ON `projects` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `projects_source_id_idx` ON `projects` (`source_id`);