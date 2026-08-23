serenity_component(
    ForgeShell
    REQUIRED
    TARGETS ForgeShell
)

set(SOURCES
    main.cpp
)

serenity_app(ForgeShell ICON app-terminal)
target_link_libraries(ForgeShell PRIVATE LibCore LibGfx LibGUI LibMain)
