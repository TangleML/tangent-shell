CREATE TABLE `shared_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`user_identity` text,
	`created_at` text NOT NULL
);
