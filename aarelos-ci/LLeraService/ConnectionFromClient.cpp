/* SPDX-License-Identifier: BSD-2-Clause */
#include "ConnectionFromClient.h"
#include <AK/Literals.h>

using namespace AK::Literals;

namespace LLeraService {

ConnectionFromClient::ConnectionFromClient(NonnullOwnPtr<Core::LocalSocket> socket, int client_id)
    : IPC::ConnectionFromClient<LLeraClientEndpoint, LLeraServerEndpoint>(*this, move(socket), client_id)
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
    if (m_killed)
        return { "killed"_string, false, false };

    if (m_denied_count > 0)
        return { "ready-policy-enforced"_string, false, m_voice_enabled };

    return { "ready-without-model"_string, false, m_voice_enabled };
}

bool ConnectionFromClient::action_allowed(String const& capability, String const& verb) const
{
    if (capability != "app.open"sv)
        return false;

    return verb == "terminal"sv
        || verb == "browser"sv
        || verb == "files"sv
        || verb == "settings"sv
        || verb == "system-monitor"sv;
}

Messages::LLeraServer::RequestActionResponse ConnectionFromClient::request_action(String const& capability, String const& verb, String const&)
{
    ++m_request_count;

    if (m_killed) {
        ++m_denied_count;
        return { false, "kill-switch-active"_string };
    }

    if (!action_allowed(capability, verb)) {
        ++m_denied_count;
        return { false, "denied-by-policy"_string };
    }

    return { true, "accepted-for-broker"_string };
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
