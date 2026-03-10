import { type NormalizedJob } from "./schemas.js";

function normalizeIsoTimestamp(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) {
    return null;
  }
  return dt.toISOString();
}

function fallbackRssTimestamp(job: Pick<NormalizedJob, "created_at" | "updated_at">, generatedAt: string): string {
  return normalizeIsoTimestamp(job.updated_at) ?? normalizeIsoTimestamp(job.created_at) ?? generatedAt;
}

function stablePreviousTimestamp(job: Pick<NormalizedJob, "rss_updated_at" | "created_at" | "updated_at">, generatedAt: string): string {
  return normalizeIsoTimestamp(job.rss_updated_at) ?? fallbackRssTimestamp(job, generatedAt);
}

function signature(job: Pick<
  NormalizedJob,
  | "title"
  | "company"
  | "location"
  | "salary"
  | "salary_min"
  | "salary_max"
  | "salary_currency"
  | "salary_period"
  | "remote"
  | "work_mode"
  | "timezone"
  | "employment_type"
  | "responsibilities"
  | "contact_channels"
  | "summary"
  | "state"
>): string {
  return JSON.stringify({
    title: job.title,
    company: job.company,
    location: job.location,
    salary: job.salary,
    salary_min: job.salary_min ?? null,
    salary_max: job.salary_max ?? null,
    salary_currency: job.salary_currency ?? null,
    salary_period: job.salary_period ?? null,
    remote: job.remote,
    work_mode: job.work_mode ?? null,
    timezone: job.timezone ?? null,
    employment_type: job.employment_type ?? null,
    responsibilities: job.responsibilities ?? null,
    contact_channels: [...(job.contact_channels ?? [])].sort(),
    summary: job.summary,
    state: job.state,
  });
}

export function stabilizeRssTimestamps(current: NormalizedJob[], previous: NormalizedJob[] | null, generatedAt: string): NormalizedJob[] {
  const previousByNumber = new Map((previous ?? []).map((job) => [job.number, job]));

  return current.map((job) => {
    const old = previousByNumber.get(job.number);
    const nextTimestamp = !old || signature(old) !== signature(job)
      ? fallbackRssTimestamp(job, generatedAt)
      : stablePreviousTimestamp(old, generatedAt);

    return {
      ...job,
      rss_updated_at: nextTimestamp,
    };
  });
}
