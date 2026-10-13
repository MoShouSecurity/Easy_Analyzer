import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandsView } from "../components/CommandsView";
import { commandCategories, responseCommands } from "../lib/commands";
import capability from "../../../capabilities/main.json";

const clipboard = vi.hoisted(() => ({ writeText: vi.fn() }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => clipboard);
beforeEach(() => {
  clipboard.writeText.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe("offline response commands", () => {
  it("ships the agreed coverage with environment and permissions for every command", () => {
    expect(new Set(responseCommands.map((item) => item.id)).size).toBe(48);
    for (const platform of ["windows", "linux"]) {
      const items = responseCommands.filter(
        (item) => item.platform === platform,
      );
      expect(items).toHaveLength(24);
      for (const category of commandCategories) {
        expect(
          items.filter((item) => item.category === category.value),
        ).toHaveLength(4);
      }
      for (const item of items) {
        expect(item.command.trim()).not.toBe("");
        expect(item.permission.trim()).not.toBe("");
        expect(item.notes.trim()).not.toBe("");
        expect(item.shell).toMatch(
          platform === "windows" ? /^(PowerShell|CMD)$/ : /^Bash$/,
        );
      }
    }
    expect(
      capability.permissions.filter((value) =>
        value.startsWith("clipboard-manager:"),
      ),
    ).toEqual(["clipboard-manager:allow-write-text"]);
  });

  it("defaults to Windows and switches the available commands to Linux", () => {
    render(<CommandsView />);
    expect(screen.getByRole("tab", { name: "Windows" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("24 条命令")).toBeVisible();
    expect(screen.getByRole("heading", { name: "查看本地账号" })).toBeVisible();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Linux" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(
      screen.getByRole("heading", { name: "查看系统账号清单" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "查看本地账号" }),
    ).not.toBeInTheDocument();
  });

  it("combines category filtering with case-insensitive title, purpose and command searches", async () => {
    const user = userEvent.setup();
    render(<CommandsView />);
    await user.click(screen.getByRole("combobox", { name: "命令分类" }));
    await user.click(screen.getByRole("option", { name: "网络排查" }));
    expect(screen.getByText("4 条命令")).toBeVisible();
    fireEvent.change(screen.getByLabelText("搜索应急响应命令"), {
      target: { value: "get-nettcpconnection" },
    });
    expect(screen.getByText("1 条命令")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "查看 TCP 连接" }),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText("搜索应急响应命令"), {
      target: { value: "绑定地址" },
    });
    expect(
      screen.getByRole("heading", { name: "查看 UDP 端点" }),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText("搜索应急响应命令"), {
      target: { value: "DNS 缓存" },
    });
    expect(
      screen.getByRole("heading", { name: "查看 DNS 缓存" }),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText("搜索应急响应命令"), {
      target: { value: "<script>no-match</script>" },
    });
    expect(
      screen.getByText("没有匹配的命令，请调整分类或搜索内容。"),
    ).toBeVisible();
    expect(document.querySelector("script")).toBeNull();
    await user.click(screen.getByRole("button", { name: "清除命令搜索" }));
    expect(screen.getByText("4 条命令")).toBeVisible();
  });

  it("copies the full multiline command without description or altered backslashes", async () => {
    render(<CommandsView />);
    const command = responseCommands.find(
      (item) => item.id === "windows-run-keys",
    )!;
    fireEvent.click(
      screen.getByRole("button", { name: `复制 ${command.title}` }),
    );
    await screen.findByText("已复制完整命令");
    expect(clipboard.writeText).toHaveBeenCalledExactlyOnceWith(
      command.command,
    );
    expect(command.command).toContain("\n");
    expect(command.command).toContain("HKLM:\\Software");
    expect(
      screen.getByRole("button", { name: `复制 ${command.title}` }),
    ).toHaveTextContent("已复制");
  });

  it("keeps the command selectable and allows retry when the clipboard fails", async () => {
    clipboard.writeText.mockRejectedValueOnce("剪贴板暂不可用");
    render(<CommandsView />);
    const button = screen.getByRole("button", { name: "复制 查看系统信息" });
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "复制失败：剪贴板暂不可用",
    );
    expect(screen.getByLabelText("查看系统信息的命令文本")).toHaveTextContent(
      "systeminfo",
    );
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await screen.findByText("已复制完整命令");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ignores a late copy result after switching the platform", async () => {
    let complete!: () => void;
    clipboard.writeText.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    render(<CommandsView />);
    fireEvent.click(screen.getByRole("button", { name: "复制 查看系统信息" }));
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Linux" }), {
      button: 0,
      ctrlKey: false,
    });
    complete();
    await waitFor(() =>
      expect(screen.queryByText("已复制完整命令")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("heading", { name: "查看系统版本" })).toBeVisible();
  });
});
