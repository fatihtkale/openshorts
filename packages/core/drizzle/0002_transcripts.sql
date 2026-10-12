CREATE TABLE `transcripts` (
	`project_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`requested_language` text DEFAULT 'auto' NOT NULL,
	`language` text,
	`engine` text,
	`model` text,
	`words` text NOT NULL,
	`word_count` integer DEFAULT 0 NOT NULL,
	`edited` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
