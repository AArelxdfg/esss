serenity_component(
    ForgeShell
    REQUIRED
    TARGETS ForgeShell
)

set(SOURCES
    main.cpp
)

compile_ipc(LLeraServer.ipc LLeraServerEndpoint.h)
compile_ipc(LLeraClient.ipc LLeraClientEndpoint.h)

set(GENERATED_SOURCES
    LLeraServerEndpoint.h
    LLeraClientEndpoint.h
)

serenity_app(ForgeShell ICON app-terminal)
target_link_libraries(ForgeShell PRIVATE LibCore LibGfx LibGUI LibIPC LibMain)
