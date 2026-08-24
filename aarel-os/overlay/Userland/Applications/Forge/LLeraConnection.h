/*
 * Copyright (c) 2026, AArel OS developers
 *
 * SPDX-License-Identifier: BSD-2-Clause
 */

#pragma once

#include <Forge/LLeraClientEndpoint.h>
#include <Forge/LLeraServerEndpoint.h>
#include <LibCore/Forward.h>
#include <LibIPC/ConnectionToServer.h>

class LLeraConnection final
    : public IPC::ConnectionToServer<LLeraClientEndpoint, LLeraServerEndpoint>
    , public LLeraClientEndpoint {
    IPC_CLIENT_CONNECTION(LLeraConnection, "/tmp/session/%sid/portal/llera"sv)

public:
    virtual void die() override;

private:
    explicit LLeraConnection(NonnullOwnPtr<Core::LocalSocket>);
};
