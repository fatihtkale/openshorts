CREATE TABLE `clips` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`proposal_id` text,
	`start_ms` integer NOT NULL,
	`end_ms` integer NOT NULL,
	`title` text NOT NULL,
	`hook` text,
	`reason` text,
	`score` integer,
	`keywords` text NOT NULL,
	`origin` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`proposal_id`) REFERENCES `proposals`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `clips_project_idx` ON `clips` (`project_id`);--> statement-breakpoint
CREATE INDEX `clips_proposal_idx` ON `clips` (`proposal_id`);--> statement-breakpoint
CREATE TABLE `proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`note` text,
	`client` text,
	`project_id` text,
	`payload` text,
	`result_project_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`decided_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `proposals_status_idx` ON `proposals` (`status`);