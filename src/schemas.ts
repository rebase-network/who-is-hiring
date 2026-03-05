import { z } from "zod";

export const githubLabelSchema = z.object({
  name: z.string(),
});

export const githubIssueSchema = z.object({
  id: z.number(),
  number: z.number(),
  html_url: z.string().url(),
  title: z.string(),
  body: z.string().nullable().optional(),
  labels: z.array(githubLabelSchema).default([]),
  state: z.string(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  closed_at: z.string().nullable().optional(),
  user: z
    .object({
      login: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export type GitHubIssue = z.infer<typeof githubIssueSchema>;

export const normalizedJobSchema = z.object({
  id: z.number(),
  number: z.number(),
  url: z.string().url(),
  title: z.string(),
  company: z.string().nullable(),
  location: z.string().nullable(),
  salary: z.string().nullable(),
  remote: z.boolean(),
  state: z.string(),
  labels: z.array(z.string()),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  closed_at: z.string().nullable().optional(),
  summary: z.string(),
  raw_body: z.string(),
  author: z.string().nullable().optional(),
});

export type NormalizedJob = z.infer<typeof normalizedJobSchema>;

export const normalizedPayloadSchema = z.object({
  generated_at: z.string(),
  repo: z.string(),
  count: z.number(),
  jobs: z.array(normalizedJobSchema),
});
