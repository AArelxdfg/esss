# SPDX-License-Identifier: BSD-2-Clause

serenity_component(
    Forge
    REQUIRED
    TARGETS Forge
)

set(SOURCES
    main.cpp
)

serenity_app(Forge ICON app-terminal)
target_link_libraries(Forge PRIVATE LibCore LibGfx LibGUI LibMain)
