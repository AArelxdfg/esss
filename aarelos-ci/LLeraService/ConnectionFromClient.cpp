/* SPDX-License-Identifier: BSD-2-Clause */
#include "ConnectionFromClient.h"
#include <AK/HashMap.h>
namespace LLeraService {

static constexpr u64 request_budget_per_connection = 4096;
static HashMap<int, RefPtr<ConnectionFromClient>> s_connections;

ConnectionFromClient::ConnectionFromClient(NonnullOwnPtr<Core::LocalSocket> socket, int client_id)
    : IPC::ConnectionFromClient<LLeraClientEndpoint, LLeraServerEndpoint>(*this, move(socket), client_id)
{
    s_connections.set(client_id, *this);
}

void ConnectionFromClient::die()
{
    s_connections.remove(client_id());
}

Messages::LLeraServer::PingResponse ConnectionFromClient::ping()
{
    return { "pong"_string };
}

Messages::LLeraServer::StatusResponse ConnectionFromClient::status()
{
    if (m_killed)
        return { "killed"_string, false, false };

    if (m_request_count >= request_budget_per_connection)
        return { "request-budget-exhausted"_string, false, false };

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

Messages::LLeraServer::RequestActionResponse ConnectionFromClient::request_action(String const& capability, String const& verb, String const& argument)
{
    ++m_request_count;

    if (m_killed) {
        ++m_denied_count;
        return { false, "kill-switch-active"_string };
    }

    if (m_request_count > request_budget_per_connection) {
        ++m_denied_count;
        m_voice_enabled = false;
        return { false, "request-budget-exhausted"_string };
    }

    if (!action_allowed(capability, verb)) {
        ++m_denied_count;
        return { false, "denied-by-policy"_string };
    }

    // app.open currently accepts no free-form argument. Keeping the IPC
    // surface structured avoids turning LLeraService into a shell-command
    // execution boundary as additional broker capabilities are introduced.
    if (!argument.is_empty()) {
        ++m_denied_count;
        return { false, "arguments-not-supported"_string };
    }

    return { true, "accepted-for-broker"_string };
}

Messages::LLeraServer::SetVoiceEnabledResponse ConnectionFromClient::set_voice_enabled(bool enabled)
{
    if (m_killed || m_request_count >= request_budget_per_connection) {
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
