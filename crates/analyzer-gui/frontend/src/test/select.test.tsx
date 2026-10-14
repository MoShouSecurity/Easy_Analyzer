import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { Select } from "../components/ui/select";

afterEach(cleanup);

it("keeps an all category distinct from the empty all-categories filter", async () => {
  const onChange = vi.fn();
  function Filter() {
    const [value, setValue] = useState("");
    return (
      <Select
        label="日志类别"
        value={value}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
        options={[
          { value: "", label: "全部类别" },
          { value: "all", label: "all" },
          { value: "login", label: "登录" },
        ]}
      />
    );
  }
  const user = userEvent.setup();
  render(<Filter />);
  const trigger = screen.getByRole("combobox", { name: "日志类别" });
  expect(trigger).toHaveTextContent(/^全部类别$/);
  await user.click(trigger);
  await user.click(screen.getByRole("option", { name: /^all$/ }));
  expect(onChange).toHaveBeenLastCalledWith("all");
  expect(trigger).toHaveTextContent(/^all$/);
  await user.click(trigger);
  await user.click(screen.getByRole("option", { name: /^全部类别$/ }));
  expect(onChange).toHaveBeenLastCalledWith("");
  expect(trigger).toHaveTextContent(/^全部类别$/);
});
