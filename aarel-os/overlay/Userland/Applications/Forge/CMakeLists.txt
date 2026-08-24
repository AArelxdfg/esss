# SPDX-License-Identifier: BSD-2-Clause

serenity_component(
    Forge
    REQUIRED
    TARGETS Forge
)

compile_ipc(LLeraServer.ipc LLeraServerEndpoint.h)
compile_ipc(LLeraClient.ipc LLeraClientEndpoint.h)

set(SOURCES
    LLeraConnection.cpp
    main.cpp
)

set(GENERATED_SOURCES
    LLeraServerEndpoint.h
    LLeraClientEndpoint.h
)

serenity_app(Forge ICON app-terminal)
target_link_libraries(Forge PRIVATE LibCore LibGfx LibGUI LibIPC LibMain)
