import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Pagination } from "../components/Pagination";
afterEach(cleanup);
it("navigates partial last pages, first pages and entered page numbers", () => {
  const page = vi.fn();
  render(<Pagination offset={100} total={125} limit={50} onPage={page} />);
  expect(screen.getByText(/第 3 \/ 3 页/)).toBeVisible();
  expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "上一页" }));
  expect(page).toHaveBeenLastCalledWith(50);
  fireEvent.click(screen.getByRole("button", { name: "首页" }));
  expect(page).toHaveBeenLastCalledWith(0);
  fireEvent.change(screen.getByRole("spinbutton", { name: "跳转页码" }), {
    target: { value: "2" },
  });
  fireEvent.click(screen.getByRole("button", { name: "跳转" }));
  expect(page).toHaveBeenLastCalledWith(50);
});
it("jumps directly to the last page without stepping through intermediate pages", () => {
  const page = vi.fn();
  render(<Pagination offset={0} total={2422767} limit={100} onPage={page} />);
  fireEvent.click(screen.getByRole("button", { name: "末页" }));
  expect(page).toHaveBeenCalledWith(2422700);
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
});
it("prevents invalid jumps and repeat page/size requests while loading", () => {
  const page = vi.fn(),
    size = vi.fn();
  const { rerender } = render(
    <Pagination
      offset={0}
      total={125}
      limit={50}
      onPage={page}
      onSize={size}
    />,
  );
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "4" } });
  expect(screen.getByRole("button", { name: "跳转" })).toBeDisabled();
  rerender(
    <Pagination
      offset={0}
      total={125}
      limit={50}
      onPage={page}
      onSize={size}
      loading
    />,
  );
  expect(screen.getByRole("combobox")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  expect(page).not.toHaveBeenCalled();
});
it("shows an empty range and disables every navigation control", () => {
  render(
    <Pagination
      label="项目"
      offset={0}
      total={0}
      limit={50}
      onPage={() => {}}
    />,
  );
  expect(screen.getByText(/0 条 · 第 0 \/ 0 页/)).toBeVisible();
  expect(screen.getByRole("spinbutton")).toBeDisabled();
  expect(screen.getByRole("button", { name: "项目 末页" })).toBeDisabled();
});

it("resets table scroll when a new page arrives", async () => {
  const { DataTable } = await import("../components/DataTable");
  const renderPage = (offset: number) => (
    <DataTable
      page={{ offset, total: 200, items: [{ id: `record-${offset}` }] }}
      columns={[{ accessorKey: "id", header: "ID" }]}
      id={(row) => row.id}
      onPage={() => {}}
    />
  );
  const { container, rerender } = render(renderPage(0));
  const scroll = container.querySelector(".table-scroll")!;
  scroll.scrollTop = 400;
  rerender(renderPage(100));
  expect(scroll.scrollTop).toBe(0);
  expect(screen.getByText("record-100")).toBeVisible();
});
