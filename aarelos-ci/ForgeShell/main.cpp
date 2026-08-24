/* SPDX-License-Identifier: BSD-2-Clause */
#include <LibCore/System.h>
#include <LibGUI/Application.h>
#include <LibGUI/BoxLayout.h>
#include <LibGUI/Button.h>
#include <LibGUI/Label.h>
#include <LibGUI/Process.h>
#include <LibGUI/Widget.h>
#include <LibGUI/Window.h>
#include <LibMain/Main.h>

static GUI::Button& add_launcher(GUI::Widget& parent, RefPtr<GUI::Window> const& window, StringView label, StringView executable)
{
    auto& button = parent.add<GUI::Button>(label);
    button.set_fixed_height(42);
    button.on_click = [window, executable](auto) {
        GUI::Process::spawn_or_show_error(window, executable);
    };
    return button;
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
    TRY(Core::System::unveil(nullptr, nullptr));

    auto window = GUI::Window::construct();
    window->set_title("AArel OS — Forge");
    window->set_fullscreen(true);

    auto root = window->set_main_widget<GUI::Widget>();
    root->set_fill_with_background_color(true);
    root->set_layout<GUI::VerticalBoxLayout>(14);
    root->layout()->set_margins({ 28, 28, 28, 28 });

    auto& top_bar = root->add<GUI::Widget>();
    top_bar.set_fixed_height(56);
    top_bar.set_layout<GUI::HorizontalBoxLayout>(10);

    auto& brand = top_bar.add<GUI::Label>("AArel OS");
    brand.set_font(brand.font().bold_variant());
    brand.set_text_alignment(Gfx::TextAlignment::CenterLeft);

    auto& mode = top_bar.add<GUI::Label>("SerenityForge Native • developer preview");
    mode.set_text_alignment(Gfx::TextAlignment::CenterRight);

    auto& hero = root->add<GUI::Label>("Forge");
    hero.set_font(hero.font().bold_variant());
    hero.set_text_alignment(Gfx::TextAlignment::CenterLeft);
    hero.set_fixed_height(48);

    auto& subtitle = root->add<GUI::Label>("Build, browse, inspect and operate from one native desktop shell.");
    subtitle.set_text_alignment(Gfx::TextAlignment::CenterLeft);
    subtitle.set_fixed_height(28);

    auto& launch_row = root->add<GUI::Widget>();
    launch_row.set_fixed_height(50);
    launch_row.set_layout<GUI::HorizontalBoxLayout>(8);

    add_launcher(launch_row, window, "Terminal", "/bin/Terminal");
    add_launcher(launch_row, window, "Browser", "/bin/Browser");
    add_launcher(launch_row, window, "Files", "/bin/FileManager");
    add_launcher(launch_row, window, "Settings", "/bin/Settings");
    add_launcher(launch_row, window, "System", "/bin/SystemMonitor");

    auto& workspace = root->add<GUI::Widget>();
    workspace.set_layout<GUI::HorizontalBoxLayout>(14);

    auto& developer_panel = workspace.add<GUI::Widget>();
    developer_panel.set_layout<GUI::VerticalBoxLayout>(8);

    auto& developer_title = developer_panel.add<GUI::Label>("Developer workspace");
    developer_title.set_font(developer_title.font().bold_variant());
    developer_title.set_fixed_height(34);

    auto& developer_body = developer_panel.add<GUI::Label>(
        "Forge is the AArel OS desktop host. Native applications remain isolated processes, while common developer tools are exposed through the SerenityOS userland and Ports environment.");
    developer_body.set_text_alignment(Gfx::TextAlignment::TopLeft);

    auto& system_panel = workspace.add<GUI::Widget>();
    system_panel.set_fixed_width(300);
    system_panel.set_layout<GUI::VerticalBoxLayout>(8);

    auto& system_title = system_panel.add<GUI::Label>("System services");
    system_title.set_font(system_title.font().bold_variant());
    system_title.set_fixed_height(34);

    auto& llera = system_panel.add<GUI::Label>("LLera IPC service: managed by SystemServer");
    llera.set_fixed_height(28);

    auto& compositor = system_panel.add<GUI::Label>("Compositor effects: capability-gated");
    compositor.set_fixed_height(28);

    auto& safety = system_panel.add<GUI::Label>("Low-end fallback: required");
    safety.set_fixed_height(28);

    auto& footer = root->add<GUI::Label>("AArel OS 0.6-dev • SerenityOS BSD-2-Clause foundation");
    footer.set_text_alignment(Gfx::TextAlignment::CenterLeft);
    footer.set_fixed_height(28);

    window->show();
    return app->exec();
}
