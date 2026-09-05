serenity_component(
    ForgeShell
    REQUIRED
    TARGETS ForgeShell
)

set(SOURCES
    main.cpp
)

compile_ipc(ForgeLLeraServer.ipc ForgeLLeraServerEndpoint.h)
compile_ipc(ForgeLLeraClient.ipc ForgeLLeraClientEndpoint.h)

set(GENERATED_SOURCES
    ForgeLLeraServerEndpoint.h
    ForgeLLeraClientEndpoint.h
)

serenity_app(ForgeShell ICON app-terminal)
target_link_libraries(ForgeShell PRIVATE LibCore LibGfx LibGUI LibIPC LibMain)
