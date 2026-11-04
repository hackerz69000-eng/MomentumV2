import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  useServerFn: vi.fn(() => vi.fn()),
}));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: mocks.useServerFn,
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: mocks.from, storage: { from: () => ({}) }, auth: {} },
}));

import { QuizRunner } from "@/components/set/QuizRunner";
import type { StudySet } from "@/lib/queries";

afterEach(() => {
  cleanup();
  mocks.from.mockReset();
  mocks.useServerFn.mockClear();
});

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const set = { id: "set-1", name: "Biology", user_id: "user-1", material_text: "Cells" } as StudySet;
  return render(<QueryClientProvider client={client}><QuizRunner set={set} kind="quiz" attempts={[]} /></QueryClientProvider>);
}

describe("optional lecture image quiz control", () => {
  it("starts unchecked and does not query saved uploads for a standard quiz", async () => {
    mocks.from.mockImplementation(() => { throw new Error("Image uploads should not be queried while the option is off."); });
    setup();
    const checkbox = screen.getByRole("checkbox", { name: /include questions about lecture images/i });
    expect(checkbox).not.toBeChecked();
    expect(screen.getByText(/leave unchecked for your usual quiz/i)).toBeInTheDocument();
    await waitFor(() => expect(mocks.from).not.toHaveBeenCalled());
  });

  it("queries eligible saved uploads only after the user opts in", async () => {
    const query = {
      select: vi.fn(), eq: vi.fn(), order: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.order.mockResolvedValue({ data: [{ id: "f1", name: "diagram.png", path: "u/diagram.png", mime: "image/png", size: 500 }], error: null });
    mocks.from.mockReturnValue(query);
    setup();
    expect(mocks.from).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: /include questions about lecture images/i }));
    await waitFor(() => expect(mocks.from).toHaveBeenCalledWith("study_files"));
    expect(await screen.findByText(/1 saved file can be checked for visuals/i)).toBeInTheDocument();
  });
});
