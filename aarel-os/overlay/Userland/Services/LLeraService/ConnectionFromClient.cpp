/*
 * Copyright (c) 2026, AArel OS developers
 *
 * SPDX-License-Identifier: BSD-2-Clause
 */

#include "ConnectionFromClient.h"
#include "Policy.h"
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

    auto decision = Policy::evaluate(capability, verb, argument);
    return { decision.accepted, String::from_utf8(decision.reason).release_value_but_fixme_should_propagate_errors() };
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
