"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api-client";

export default function CreateProjectForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await api.createProject({
        name: name.trim(),
        description: description || null,
      });
      setName("");
      setDescription("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 rounded-lg bg-surface p-4 shadow-card">
        <Input id="project-name" label="Name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Bracket assembly" required className="min-w-[180px] flex-1" />
        <Input id="project-description" label="Description (optional)" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Load-bearing mount plate" className="min-w-[220px] flex-[2]" />
        <Button type="submit" loading={creating}>
          New project
        </Button>
      </form>
    </>
  );
}
