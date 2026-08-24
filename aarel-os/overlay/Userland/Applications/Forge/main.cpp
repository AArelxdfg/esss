/*
 * Copyright (c) 2026, AArel OS developers
 *
 * SPDX-License-Identifier: BSD-2-Clause
 */

#include "LLeraConnection.h"
#include <LibCore/System.h>
#include <LibGUI/Application.h>
#include <LibGUI/BoxLayout.h>
#include <LibGUI/Button.h>
#include <LibGUI/Label.h>
#include <LibGUI/Process.h>
#include <LibGUI/Widget.h>
#include <LibGUI/Window.h>
#include <LibMain/Main.h>

ErrorOr<int> serenity_main(Main::Arguments arguments)
{
    TRY(Core::System::pledge("stdio recvfd sendfd rpath unix proc exec"));

    auto app = TRY(GUI::Application::create(arguments));

    TRY(Core::System::unveil("/res", "r"));
    TRY(Core::System::unveil("/bin/Terminal", "x"));
    TRY(Core::System::unveil("/bin/Browser", "x"));
    TRY(Core::System::unveil("/bin/FileManager", "x"));
    TRY(Core::System::unveil("/bin/Settings", "x"));
    TRY(Core::System::unveil(nullptr, nullptr));

    auto window = GUI::Window::construct();
    window->set_title("AArel OS — Forge");
    window->resize(1120, 700);
    window->set_maximized(true);
    window->set_closeable(false);
    window->set_minimizable(false);

    auto root = window->set_main_widget<GUI::Widget>();
    root->set_fill_with_background_color(true);
    root->set_layout<GUI::VerticalBoxLayout>(12);
    root->layout()->set_margins({ 28, 28, 28, 28 });

    auto& title = root->add<GUI::Label>("Forge");
    title.set_font(title.font().bold_variant());
    title.set_text_alignment(Gfx::TextAlignment::CenterLeft);
    title.set_fixed_height(38);

    auto& subtitle = root->add<GUI::Label>("AArel OS developer desktop");
    subtitle.set_text_alignment(Gfx::TextAlignment::CenterLeft);
    subtitle.set_fixed_height(24);

    auto add_launcher = [&](StringView label, StringView executable) {
        auto& button = root->add<GUI::Button>(label);
        button.set_fixed_height(46);
        button.on_click = [window, executable](auto) {
            GUI::Process::spawn_or_show_error(window, executable);
        };
    };

    add_launcher("Forge Terminal", "/bin/Terminal");
    add_launcher("Browser", "/bin/Browser");
    add_launcher("Files", "/bin/FileManager");
    add_launcher("Settings", "/bin/Settings");

    auto& llera_status = root->add<GUI::Label>("LLera service: connecting");
    llera_status.set_text_alignment(Gfx::TextAlignment::CenterLeft);
    llera_status.set_fixed_height(26);

    RefPtr<LLeraConnection> llera_connection;
    auto llera_connection_or_error = LLeraConnection::try_create();
    if (llera_connection_or_error.is_error()) {
        llera_status.set_text("LLera service: unavailable");
    } else {
        llera_connection = llera_connection_or_error.release_value();
        auto status = llera_connection->status();
        llera_status.set_text(status.state());
    }

    auto& llera_refresh = root->add<GUI::Button>("Refresh LLera service status");
    llera_refresh.set_fixed_height(40);
    llera_refresh.set_enabled(llera_connection != nullptr);
    llera_refresh.on_click = [llera_connection, &llera_status](auto) {
        if (!llera_connection) {
            llera_status.set_text("LLera service: unavailable");
            return;
        }
        auto status = llera_connection->status();
        llera_status.set_text(status.state());
    };

    window->show();
    return app->exec();
}
