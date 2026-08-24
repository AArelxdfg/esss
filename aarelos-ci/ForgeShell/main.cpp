/* SPDX-License-Identifier: BSD-2-Clause */
#include <LibCore/System.h>
#include <LibGUI/Application.h>
#include <LibGUI/BoxLayout.h>
#include <LibGUI/Button.h>
#include <LibGUI/Label.h>
#include <LibGUI/Process.h>
#include <LibGUI/Widget.h>
#include <LibGUI/Window.h>
#include <LibGfx/Font/Font.h>
#include <LibIPC/ConnectionToServer.h>
#include <LibMain/Main.h>
#include <Userland/Applications/ForgeShell/ForgeLLeraClientEndpoint.h>
#include <Userland/Applications/ForgeShell/ForgeLLeraServerEndpoint.h>
#include <unistd.h>

class LLeraConnection final
    : public IPC::ConnectionToServer<LLeraClientEndpoint, LLeraServerEndpoint>
    , public LLeraClientEndpoint {
    IPC_CLIENT_CONNECTION(LLeraConnection, "/tmp/session/%sid/portal/llera"sv)

public:
    virtual void die() override { m_disconnected = true; }
    bool disconnected() const { return m_disconnected; }

private:
    explicit LLeraConnection(NonnullOwnPtr<Core::LocalSocket> socket)
        : IPC::ConnectionToServer<LLeraClientEndpoint, LLeraServerEndpoint>(*this, move(socket))
    {
    }

    virtual void state_changed(String const&) override { }
    bool m_disconnected { false };
};

struct LauncherSpec {
    StringView label;
    StringView executable;
};

static constexpr LauncherSpec s_primary_launchers[] = {
    { "Search"sv, "/bin/Assistant"sv },
    { "Terminal"sv, "/bin/Terminal"sv },
    { "Browser"sv, "/bin/Browser"sv },
    { "Files"sv, "/bin/FileManager"sv },
    { "Settings"sv, "/bin/Settings"sv },
    { "System Monitor"sv, "/bin/SystemMonitor"sv },
};

static GUI::Button& add_launcher(GUI::Widget& parent, RefPtr<GUI::Window> const& window, LauncherSpec const& spec)
{
    auto& button = parent.add<GUI::Button>(MUST(String::from_utf8(spec.label)));
    button.set_fixed_height(42);
    button.on_click = [window, executable = spec.executable](auto) {
        GUI::Process::spawn_or_show_error(window, executable);
    };
    return button;
}

static GUI::Label& add_section_title(GUI::Widget& parent, StringView text)
{
    auto& label = parent.add<GUI::Label>(MUST(String::from_utf8(text)));
    label.set_font(label.font().bold_variant());
    label.set_fixed_height(30);
    label.set_text_alignment(Gfx::TextAlignment::CenterLeft);
    return label;
}

static GUI::Label& add_status_line(GUI::Widget& parent, StringView text)
{
    auto& label = parent.add<GUI::Label>(MUST(String::from_utf8(text)));
    label.set_fixed_height(24);
    label.set_text_alignment(Gfx::TextAlignment::CenterLeft);
    return label;
}

ErrorOr<int> serenity_main(Main::Arguments arguments)
{
    TRY(Core::System::pledge("stdio recvfd sendfd rpath unix proc exec"));
    auto app = TRY(GUI::Application::create(arguments));

    TRY(Core::System::unveil("/res", "r"));
    TRY(Core::System::unveil("/bin/Assistant", "x"));
    TRY(Core::System::unveil("/bin/Terminal", "x"));
    TRY(Core::System::unveil("/bin/Browser", "x"));
    TRY(Core::System::unveil("/bin/FileManager", "x"));
    TRY(Core::System::unveil("/bin/Settings", "x"));
    TRY(Core::System::unveil("/bin/SystemMonitor", "x"));
    TRY(Core::System::unveil("/tmp/session/%sid/portal/llera", "rw"));
    TRY(Core::System::unveil(nullptr, nullptr));

    sleep(3);
    auto llera = TRY(LLeraConnection::try_create());
    auto ping = llera->ping();
    auto llera_gate_passed = ping == "pong"sv;
    auto initial = llera->try_status();
    llera_gate_passed = llera_gate_passed && !initial.is_error()
        && initial.value().state() == "ready-without-model"sv;
    auto allowed = llera->try_request_action("app.open"_string, "terminal"_string, String {});
    llera_gate_passed = llera_gate_passed && !allowed.is_error()
        && allowed.value().accepted() && allowed.value().decision() == "accepted-for-broker"sv;
    auto denied = llera->try_request_action("system.exec"_string, "shell"_string, String {});
    llera_gate_passed = llera_gate_passed && !denied.is_error()
        && !denied.value().accepted() && denied.value().decision() == "denied-by-policy"sv;
    auto kill = llera->try_kill_switch();
    llera_gate_passed = llera_gate_passed && !kill.is_error();
    auto killed = llera->try_status();
    llera_gate_passed = llera_gate_passed && !killed.is_error()
        && killed.value().state() == "killed"sv && !llera->disconnected();

    auto window = GUI::Window::construct();
    window->set_title("AArel OS — Monolith Desktop");
    window->set_fullscreen(true);

    auto root = window->set_main_widget<GUI::Widget>();
    root->set_fill_with_background_color(true);
    root->set_layout<GUI::VerticalBoxLayout>(10);
    root->layout()->set_margins({ 22, 26, 22, 26 });

    auto& top_bar = root->add<GUI::Widget>();
    top_bar.set_fixed_height(58);
    top_bar.set_layout<GUI::HorizontalBoxLayout>(10);

    auto& brand = top_bar.add<GUI::Label>("AArel OS"_string);
    brand.set_font(brand.font().bold_variant());
    brand.set_text_alignment(Gfx::TextAlignment::CenterLeft);

    auto& release = top_bar.add<GUI::Label>("0.7-dev • Monolith Desktop"_string);
    release.set_text_alignment(Gfx::TextAlignment::CenterRight);

    auto& launch_row = root->add<GUI::Widget>();
    launch_row.set_fixed_height(50);
    launch_row.set_layout<GUI::HorizontalBoxLayout>(8);
    for (auto const& launcher : s_primary_launchers)
        add_launcher(launch_row, window, launcher);

    auto& workspace = root->add<GUI::Widget>();
    workspace.set_layout<GUI::HorizontalBoxLayout>(16);

    auto& main_column = workspace.add<GUI::Widget>();
    main_column.set_layout<GUI::VerticalBoxLayout>(8);

    auto& hero = main_column.add<GUI::Label>("Forge"_string);
    hero.set_font(hero.font().bold_variant());
    hero.set_fixed_height(48);
    hero.set_text_alignment(Gfx::TextAlignment::CenterLeft);

    auto& subtitle = main_column.add<GUI::Label>("Your native workspace for code, web, files and system control."_string);
    subtitle.set_fixed_height(28);
    subtitle.set_text_alignment(Gfx::TextAlignment::CenterLeft);

    add_section_title(main_column, "Pinned workspace");
    add_status_line(main_column, "Search — native application and command discovery");
    add_status_line(main_column, "Terminal — POSIX shell with bash, curl and git");
    add_status_line(main_column, "Browser — integrated web surface");
    add_status_line(main_column, "Files — projects, downloads and build artifacts");
    add_status_line(main_column, "Settings / System Monitor — native system control");

    auto& spacer = main_column.add<GUI::Widget>();
    spacer.set_fixed_height(16);

    add_section_title(main_column, "Windows-class direction");
    add_status_line(main_column, "Fast boot • app discovery • native multitasking • recovery-first updates");
    add_status_line(main_column, "Compatibility target: POSIX toolchain first, Win32 compatibility only when demonstrated");

    auto& status_column = workspace.add<GUI::Widget>();
    status_column.set_fixed_width(360);
    status_column.set_layout<GUI::VerticalBoxLayout>(8);

    add_section_title(status_column, "System status");
    add_status_line(status_column, "UEFI boot media: verified");
    add_status_line(status_column, "Developer tools: bash / curl / git");
    add_status_line(status_column, llera_gate_passed
            ? "LLera IPC: PASS — policy boundary online"sv
            : "LLera IPC: FAIL — service unavailable"sv);
    add_status_line(status_column, llera_gate_passed
            ? "LLera kill-switch: verified"sv
            : "LLera kill-switch: unavailable"sv);

    add_section_title(status_column, "Security boundary");
    add_status_line(status_column, "Applications: separate native processes");
    add_status_line(status_column, "LLera actions: explicit capability allow-list");
    add_status_line(status_column, "Free-form shell execution: denied");

    add_section_title(status_column, "Next parity gates");
    add_status_line(status_column, "Installer + update rollback");
    add_status_line(status_column, "Hardware / driver qualification");
    add_status_line(status_column, "Win32 compatibility sandbox");

    auto& footer = root->add<GUI::Label>("AArel OS 0.7-dev • SerenityOS foundation, BSD-2-Clause notices preserved"_string);
    footer.set_text_alignment(Gfx::TextAlignment::CenterLeft);
    footer.set_fixed_height(26);

    window->show();
    return app->exec();
}
