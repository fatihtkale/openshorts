CREATE TABLE `compilations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`items` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`version` integer DEFAULT 1 NOT NULL,
	`rendered_version` integer,
	`duration_ms` integer,
	`chapters` text,
	`project_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
