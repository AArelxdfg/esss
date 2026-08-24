/*
 * Copyright (c) 2026, AArel OS developers
 *
 * SPDX-License-Identifier: BSD-2-Clause
 */

#pragma once

#include <LibIPC/ConnectionFromClient.h>
#include <LLeraService/LLeraClientEndpoint.h>
#include <LLeraService/LLeraServerEndpoint.h>

namespace LLeraService {

class ConnectionFromClient final : public IPC::ConnectionFromClient<LLeraClientEndpoint, LLeraServerEndpoint> {
    C_OBJECT(ConnectionFromClient)
public:
    ~ConnectionFromClient() override = default;

    virtual void die() override;

private:
    explicit ConnectionFromClient(NonnullOwnPtr<Core::LocalSocket>, int client_id);

    virtual Messages::LLeraServer::PingResponse ping() override;
    virtual Messages::LLeraServer::StatusResponse status() override;
    virtual Messages::LLeraServer::RequestActionResponse request_action(String const& capability, String const& verb, String const& argument) override;
    virtual Messages::LLeraServer::SetVoiceEnabledResponse set_voice_enabled(bool enabled) override;
    virtual void kill_switch() override;
};

}
