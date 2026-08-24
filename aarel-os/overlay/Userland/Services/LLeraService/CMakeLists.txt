# SPDX-License-Identifier: BSD-2-Clause

serenity_component(
    LLeraService
    REQUIRED
    TARGETS LLeraService
)

compile_ipc(LLeraServer.ipc LLeraServerEndpoint.h)
compile_ipc(LLeraClient.ipc LLeraClientEndpoint.h)

set(SOURCES
    ConnectionFromClient.cpp
    main.cpp
)

set(GENERATED_SOURCES
    LLeraServerEndpoint.h
    LLeraClientEndpoint.h
)

serenity_bin(LLeraService)
target_link_libraries(LLeraService PRIVATE LibCore LibIPC LibMain)
