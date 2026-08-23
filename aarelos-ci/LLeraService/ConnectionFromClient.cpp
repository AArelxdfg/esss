/* SPDX-License-Identifier: BSD-2-Clause */
#include "ConnectionFromClient.h"

using namespace AK::Literals;

namespace LLeraService {

ConnectionFromClient::ConnectionFromClient(NonnullOwnPtr<Core::LocalSocket> socket, int client_id)
    : IPC::ConnectionFromClient<LLeraClientEndpoint, LLeraServerEndpoint>(move(socket), client_id)
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
        m_voice_enabled && !m_killed
    };
}

Messages::LLeraServer::RequestActionResponse ConnectionFromClient::request_action(String const& capability, String const& verb, String const&)
{
    if (m_killed)
        return { false, "kill-switch-active"_string };

    if (capability == "app.open"sv && (verb == "terminal"sv || verb == "browser"sv || verb == "files"sv))
        return { true, "accepted-for-broker"_string };

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
