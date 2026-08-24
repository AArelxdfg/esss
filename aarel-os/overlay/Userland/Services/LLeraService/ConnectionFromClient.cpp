/*
 * Copyright (c) 2026, AArel OS developers
 *
 * SPDX-License-Identifier: BSD-2-Clause
 */

#include "ConnectionFromClient.h"
#include <AK/Literals.h>

using namespace AK::Literals;

namespace LLeraService {

ConnectionFromClient::ConnectionFromClient(NonnullOwnPtr<Core::LocalSocket> client_socket, int client_id)
    : IPC::ConnectionFromClient<LLeraClientEndpoint, LLeraServerEndpoint>(*this, move(client_socket), client_id)
{
}

void ConnectionFromClient::die()
{
    shutdown();
}

Messages::LLeraServer::PingResponse ConnectionFromClient::ping()
{
    return { "pong"_string };
}

Messages::LLeraServer::StatusResponse ConnectionFromClient::status()
{
    return {
        m_killed ? "killed"_string : "ready-without-model"_string,
        false,
        m_voice_enabled && !m_killed,
    };
}

Messages::LLeraServer::RequestActionResponse ConnectionFromClient::request_action(String const& capability, String const& verb, String const& argument)
{
    if (m_killed)
        return { false, "kill-switch-active"_string };

    // LLera is intentionally not a generic command-execution service. Every
    // privileged action must be brokered through a named capability.
    if (capability == "app.open"sv) {
        if (verb == "terminal"sv || verb == "browser"sv || verb == "files"sv)
            return { true, "accepted-for-forge-broker"_string };
        return { false, "unsupported-app"_string };
    }

    if (capability == "web.open"sv) {
        if (verb != "url"sv)
            return { false, "unsupported-web-verb"_string };
        if (!(argument.starts_with("https://"sv) || argument.starts_with("http://"sv)))
            return { false, "invalid-web-url"_string };
        return { true, "accepted-for-browser-broker"_string };
    }

    return { false, "denied-by-policy"_string };
}

Messages::LLeraServer::SetVoiceEnabledResponse ConnectionFromClient::set_voice_enabled(bool enabled)
{
    if (m_killed) {
        m_voice_enabled = false;
        return { false };
    }

    m_voice_enabled = enabled;
    return { m_voice_enabled };
}

void ConnectionFromClient::kill_switch()
{
    m_killed = true;
    m_voice_enabled = false;
}

}
