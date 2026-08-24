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
    { "Forge Terminal"sv, "/bin/Terminal"sv },
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
    TRY(Core::System::unveil("/bin/Terminal", "x"));
    TRY(Core::System::unveil("/bin/Browser", "x"));
    TRY(Core::System::unveil("/bin/FileManager", "x"));
    TRY(Core::System::unveil("/bin/Settings", "x"));
    TRY(Core::System::unveil("/bin/SystemMonitor", "x"));
    TRY(Core::System::unveil("/tmp/session/%sid/portal/llera", "rw"));
    TRY(Core::System::unveil(nullptr, nullptr));

    auto llera = TRY(LLeraConnection::try_create());
    auto ping = llera->ping();
    auto initial = llera->status();
    auto allowed = llera->request_action("app.open"_string, "terminal"_string, String {});
    auto denied = llera->request_action("system.exec"_string, "shell"_string, String {});
    llera->kill_switch();
    auto killed = llera->status();
    auto llera_gate_passed = ping == "pong"sv
        && initial.state() == "ready-without-model"sv
        && allowed.accepted() && allowed.decision() == "accepted-for-broker"sv
        && !denied.accepted() && denied.decision() == "denied-by-policy"sv
        && killed.state() == "killed"sv && !llera->disconnected();
    if (!llera_gate_passed)
        return Error::from_string_literal("LLera IPC runtime gate failed");

    auto window = GUI::Window::construct();
    window->set_title("AArel OS — Forge");
    window->set_fullscreen(true);

    auto root = window->set_main_widget<GUI::Widget>();
    root->set_fill_with_background_color(true);
    root->set_layout<GUI::VerticalBoxLayout>(12);
    root->layout()->set_margins({ 24, 24, 24, 24 });

    auto& top_bar = root->add<GUI::Widget>();
    top_bar.set_fixed_height(54);
    top_bar.set_layout<GUI::HorizontalBoxLayout>(10);

    auto& brand = top_bar.add<GUI::Label>("AArel OS"_string);
    brand.set_font(brand.font().bold_variant());
    brand.set_text_alignment(Gfx::TextAlignment::CenterLeft);

    auto& mode = top_bar.add<GUI::Label>("SerenityForge Native • 0.6-dev"_string);
    mode.set_text_alignment(Gfx::TextAlignment::CenterRight);

    auto& launch_row = root->add<GUI::Widget>();
    launch_row.set_fixed_height(48);
    launch_row.set_layout<GUI::HorizontalBoxLayout>(8);
    for (auto const& launcher : s_primary_launchers)
        add_launcher(launch_row, window, launcher);

    auto& workspace = root->add<GUI::Widget>();
    workspace.set_layout<GUI::HorizontalBoxLayout>(14);

    auto& left = workspace.add<GUI::Widget>();
    left.set_layout<GUI::VerticalBoxLayout>(8);

    auto& hero = left.add<GUI::Label>("Forge Workspace"_string);
    hero.set_font(hero.font().bold_variant());
    hero.set_fixed_height(46);
    hero.set_text_alignment(Gfx::TextAlignment::CenterLeft);

    auto& subtitle = left.add<GUI::Label>("Native desktop host for building, browsing, debugging and operating AArel OS."_string);
    subtitle.set_fixed_height(28);
    subtitle.set_text_alignment(Gfx::TextAlignment::CenterLeft);

    add_section_title(left, "Developer workspace"sv);
    add_status_line(left, "• Terminal: native Serenity terminal with POSIX userland/Ports path"sv);
    add_status_line(left, "• Browser: native Browser launcher with web integration path"sv);
    add_status_line(left, "• Files: FileManager-backed project and artifact navigation"sv);
    add_status_line(left, "• System: SystemMonitor and Settings remain independent native processes"sv);

    auto& spacer = left.add<GUI::Widget>();
    spacer.set_fixed_height(12);

    add_section_title(left, "Desktop contract"sv);
    auto& desktop_contract = left.add<GUI::Label>(
        "Forge is the graphical session desktop host, not a decorative launcher. It owns the always-on workspace surface while applications remain separate processes under SerenityOS security boundaries."_string);
    desktop_contract.set_text_alignment(Gfx::TextAlignment::TopLeft);

    auto& right = workspace.add<GUI::Widget>();
    right.set_fixed_width(340);
    right.set_layout<GUI::VerticalBoxLayout>(8);

    add_section_title(right, "System services"sv);
    add_status_line(right, "LLera IPC: PASS — ping/status/request/deny/kill"sv);
    add_status_line(right, "State after kill-switch: killed"sv);
    add_status_line(right, "Policy: explicit capability allow-list"sv);
    add_status_line(right, "Kill switch: service-enforced"sv);

    add_section_title(right, "Graphics"sv);
    add_status_line(right, "Compositor effects: capability-gated"sv);
    add_status_line(right, "Low-end fallback: required"sv);

    add_section_title(right, "Boot / recovery"sv);
    add_status_line(right, "UEFI raw image: separate artifact"sv);
    add_status_line(right, "Optical ISO: must be genuine ISO9660/El Torito"sv);
    add_status_line(right, "Rollback: update generation boundary"sv);

    auto& footer = root->add<GUI::Label>("AArel OS 0.6-dev • SerenityOS BSD-2-Clause foundation"_string);
    footer.set_text_alignment(Gfx::TextAlignment::CenterLeft);
    footer.set_fixed_height(26);

    window->show();
    return app->exec();
}
