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

static bool s_killed;
static bool s_voice_enabled;

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
    return { s_killed ? "killed"_string : "pong"_string };
}

Messages::LLeraServer::StatusResponse ConnectionFromClient::status()
{
    return {
        s_killed ? "killed"_string : "ready-without-model"_string,
        false,
        s_voice_enabled && !s_killed,
    };
}

Messages::LLeraServer::RequestActionResponse ConnectionFromClient::request_action(String const& capability, String const& verb, String const& argument)
{
    if (s_killed)
        return { false, "kill-switch-active"_string };

    auto decision = Policy::evaluate(capability, verb, argument);
    return { decision.accepted, move(decision.reason) };
}

Messages::LLeraServer::SetVoiceEnabledResponse ConnectionFromClient::set_voice_enabled(bool enabled)
{
    if (s_killed) {
        s_voice_enabled = false;
        return { false };
    }

    s_voice_enabled = enabled;
    return { s_voice_enabled };
}

void ConnectionFromClient::kill_switch()
{
    // This is intentionally service-global rather than connection-local. A second
    // client must not be able to continue privileged LLera requests after another
    // trusted client has activated the emergency stop.
    s_killed = true;
    s_voice_enabled = false;
}

}
