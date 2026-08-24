/*
 * Copyright (c) 2026, AArel OS developers
 *
 * SPDX-License-Identifier: BSD-2-Clause
 */

#include "LLeraConnection.h"

LLeraConnection::LLeraConnection(NonnullOwnPtr<Core::LocalSocket> socket)
    : IPC::ConnectionToServer<LLeraClientEndpoint, LLeraServerEndpoint>(*this, move(socket))
{
}

void LLeraConnection::die()
{
    shutdown();
}
