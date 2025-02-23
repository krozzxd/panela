import { ButtonInteraction, EmbedBuilder, PermissionsBitField, Message, TextChannel, GuildMember, Collection, GuildMemberRoleManager } from "discord.js";
import { storage } from "../storage";
import { log } from "../vite";
import { getRoleLimit, addMember, removeMember, getMemberAddedBy, getMembersAddedByUser, type GuildConfig } from "@shared/schema";

// Map para armazenar coletores de atribuição de cargo ativos
const roleAssignmentCollectors = new Map();

// Função atualizada para mostrar apenas os membros adicionados pelo usuário
function formatMembersList(members: Collection<string, GuildMember>, requesterId: string, roleId: string, config: GuildConfig): string {
  if (!members || members.size === 0) return "• Nenhum membro";

  // Obter apenas os membros que este usuário adicionou
  const userMembers = getMembersAddedByUser(config, roleId, requesterId);
  if (userMembers.length === 0) return "• Nenhum membro";

  return userMembers
    .map(memberId => {
      const member = members.get(memberId);
      return member ? `• ${member.user.username}` : null;
    })
    .filter(Boolean)
    .join("\n");
}

async function handlePanelaMenu(interaction: ButtonInteraction): Promise<void> {
  try {
    const config = await storage.getGuildConfig(interaction.guildId!);
    if (!config) {
      const reply = await interaction.followUp({
        content: "Use h!panela config primeiro!",
        ephemeral: true
      });
      setTimeout(() => reply.delete().catch(() => {}), 60000); // Updated timeout
      return;
    }

    // Verificar permissões do usuário
    if (config.allowedRoles && config.allowedRoles.length > 0) {
      const memberRoles = interaction.member!.roles as GuildMemberRoleManager;
      const hasPermission = memberRoles.cache.some(role =>
        config.allowedRoles!.includes(role.id)
      );
      if (!hasPermission) {
        const reply = await interaction.followUp({
          content: "Você não tem permissão para usar este comando!",
          ephemeral: true
        });
        setTimeout(() => reply.delete().catch(() => {}), 60000); // Updated timeout
        return;
      }
    }

    const roles = await interaction.guild!.roles.fetch();
    const firstLadyRole = roles.get(config.firstLadyRoleId!);
    const antiBanRole = roles.get(config.antiBanRoleId!);
    const usRole = roles.get(config.usRoleId!);

    if (!firstLadyRole || !antiBanRole || !usRole) {
      const reply = await interaction.followUp({
        content: "Um ou mais cargos configurados não existem mais neste servidor.",
        ephemeral: true
      });
      setTimeout(() => reply.delete().catch(() => {}), 60000); // Updated timeout
      return;
    }

    // Proteção especial para o cargo us
    try {
      await usRole.setPermissions([]);
      await usRole.setMentionable(false);
    } catch (error) {
      log(`Erro ao configurar permissões do cargo us: ${error}`, "discord");
    }

    // Obter apenas os membros adicionados por este usuário
    const userFirstLady = getMembersAddedByUser(config, config.firstLadyRoleId!, interaction.user.id);
    const userAntiBan = getMembersAddedByUser(config, config.antiBanRoleId!, interaction.user.id);
    const userUs = getMembersAddedByUser(config, config.usRoleId!, interaction.user.id);

    const firstLadyLimit = getRoleLimit(config, config.firstLadyRoleId!);
    const antiBanLimit = getRoleLimit(config, config.antiBanRoleId!);
    const usLimit = getRoleLimit(config, config.usRoleId!);

    // Atualizar o embed com os membros que o usuário adicionou
    const embed = new EmbedBuilder()
      .setTitle("👥 Sua Panela")
      .setDescription(
        `<:anel:1337954327226093598> **Primeira Dama** (${userFirstLady.length}/${firstLadyLimit})\n${formatMembersList(firstLadyRole.members, interaction.user.id, config.firstLadyRoleId!, config)}\n\n` +
        `<:martelo:1337267926452932628> **Antiban** (${userAntiBan.length}/${antiBanLimit})\n${formatMembersList(antiBanRole.members, interaction.user.id, config.antiBanRoleId!, config)}\n\n` +
        `<:cor:1337925018872709230> **Us** (${userUs.length}/${usLimit})\n${formatMembersList(usRole.members, interaction.user.id, config.usRoleId!, config)}`
      )
      .setColor("#2F3136")
      .setTimestamp();

    const reply = await interaction.followUp({
      embeds: [embed],
      ephemeral: true
    });
    setTimeout(() => reply.delete().catch(() => {}), 60000); // Updated timeout
  } catch (error) {
    log(`Erro ao criar menu: ${error}`, "discord");
    const reply = await interaction.followUp({
      content: "Ocorreu um erro ao criar o menu. Tente novamente.",
      ephemeral: true
    });
    setTimeout(() => reply.delete().catch(() => {}), 60000); // Updated timeout
  }
}

async function toggleRole(
  interaction: ButtonInteraction,
  roleId: string,
  roleName: string,
  targetUserId: string
): Promise<void> {
  try {
    const config = await storage.getGuildConfig(interaction.guildId!);
    if (!config) {
      const reply = await interaction.followUp({
        content: "Use h!panela config primeiro!",
        ephemeral: true
      });
      setTimeout(() => reply.delete().catch(() => {}), 60000);
      return;
    }

    const targetMember = await interaction.guild!.members.fetch(targetUserId);
    if (!targetMember) {
      const reply = await interaction.followUp({
        content: "Usuário não encontrado no servidor!",
        ephemeral: true
      });
      setTimeout(() => reply.delete().catch(() => {}), 60000);
      return;
    }

    const role = await interaction.guild!.roles.fetch(roleId);
    if (!role) {
      const reply = await interaction.followUp({
        content: `Cargo ${roleName} não encontrado!`,
        ephemeral: true
      });
      setTimeout(() => reply.delete().catch(() => {}), 60000);
      return;
    }

    // Proteção especial para o cargo us
    if (roleName === "Us") {
      try {
        await role.setPermissions([]);
        await role.setMentionable(false);
      } catch (error) {
        log(`Erro ao configurar permissões do cargo us: ${error}`, "discord");
        const reply = await interaction.followUp({
          content: "Erro ao configurar permissões do cargo us.",
          ephemeral: true
        });
        setTimeout(() => reply.delete().catch(() => {}), 60000);
        return;
      }
    }

    const hasRole = targetMember.roles.cache.has(roleId);
    const addedByUserId = getMemberAddedBy(config, roleId, targetMember.id);

    // Verificar se o membro já está em alguma panela de outro usuário
    const panelas = [config.firstLadyRoleId!, config.antiBanRoleId!, config.usRoleId!];
    for (const panelaId of panelas) {
      const panelaAddedBy = getMemberAddedBy(config, panelaId, targetMember.id);
      if (panelaAddedBy && panelaAddedBy !== interaction.user.id) {
        const panelaRole = await interaction.guild!.roles.fetch(panelaId);
        const reply = await interaction.followUp({
          content: `Este membro já está na panela ${panelaRole?.name || 'desconhecida'} de outro usuário!`,
          ephemeral: true
        });
        setTimeout(() => reply.delete().catch(() => {}), 60000);
        return;
      }
    }

    if (hasRole) {
      // Só pode remover se foi quem adicionou
      if (addedByUserId !== interaction.user.id) {
        const reply = await interaction.followUp({
          content: "Você só pode remover membros que você mesmo adicionou!",
          ephemeral: true
        });
        setTimeout(() => reply.delete().catch(() => {}), 60000);
        return;
      }

      // Remover o cargo e a entrada no registro
      await targetMember.roles.remove(role);
      const updatedMemberAddedBy = removeMember(config, roleId, targetMember.id);
      await storage.updateGuildConfig(interaction.guildId!, { memberAddedBy: updatedMemberAddedBy });

      const reply = await interaction.followUp({
        content: `Cargo ${roleName} removido de ${targetMember}!`,
        ephemeral: true
      });
      setTimeout(() => reply.delete().catch(() => {}), 60000);
      log(`Cargo ${roleName} removido do usuário ${targetMember.user.tag} por ${interaction.user.tag}`, "discord");
    } else {
      // Verificar limite individual
      const userMembers = getMembersAddedByUser(config, roleId, interaction.user.id);
      const roleLimit = getRoleLimit(config, roleId);

      if (userMembers.length >= roleLimit) {
        const reply = await interaction.followUp({
          content: `Você já atingiu o limite de ${roleLimit} membros para o cargo ${roleName}!`,
          ephemeral: true
        });
        setTimeout(() => reply.delete().catch(() => {}), 60000);
        return;
      }

      // Adicionar o cargo e registrar quem adicionou
      await targetMember.roles.add(role);
      const updatedMemberAddedBy = addMember(config, roleId, targetMember.id, interaction.user.id);
      await storage.updateGuildConfig(interaction.guildId!, { memberAddedBy: updatedMemberAddedBy });

      const reply = await interaction.followUp({
        content: `Cargo ${roleName} adicionado para ${targetMember}!`,
        ephemeral: true
      });
      setTimeout(() => reply.delete().catch(() => {}), 60000);
      log(`Cargo ${roleName} adicionado ao usuário ${targetMember.user.tag} por ${interaction.user.tag}`, "discord");
    }
  } catch (error) {
    log(`Erro ao modificar cargo ${roleName}: ${error}`, "discord");
    const reply = await interaction.followUp({
      content: `Erro ao modificar o cargo ${roleName}. Por favor, tente novamente.`,
      ephemeral: true
    });
    setTimeout(() => reply.delete().catch(() => {}), 60000);
  }
}

export async function handleButtons(interaction: ButtonInteraction) {
  try {
    await interaction.deferUpdate();

    switch (interaction.customId) {
      case "primeira-dama":
      case "antiban":
      case "us": {
        const config = await storage.getGuildConfig(interaction.guildId!);
        if (!config) {
          const reply = await interaction.followUp({
            content: "Use h!panela config primeiro!",
            ephemeral: true
          });
          setTimeout(() => reply.delete().catch(() => {}), 60000);
          return;
        }

        // Verificar permissões do usuário
        if (config.allowedRoles && config.allowedRoles.length > 0) {
          const memberRoles = interaction.member!.roles as GuildMemberRoleManager;
          const hasPermission = memberRoles.cache.some(role =>
            config.allowedRoles!.includes(role.id)
          );

          if (!hasPermission) {
            const reply = await interaction.followUp({
              content: "Você não tem permissão para usar este comando!",
              ephemeral: true
            });
            setTimeout(() => reply.delete().catch(() => {}), 60000);
            return;
          }
        } else {
          const reply = await interaction.followUp({
            content: "Nenhum cargo está autorizado a usar o comando. Peça ao dono para configurar com h!panela allow @cargo",
            ephemeral: true
          });
          setTimeout(() => reply.delete().catch(() => {}), 60000);
          return;
        }

        const buttonConfig = {
          "primeira-dama": {
            roleId: config.firstLadyRoleId,
            name: "Primeira Dama",
          },
          "antiban": {
            roleId: config.antiBanRoleId,
            name: "Antiban",
          },
          "us": {
            roleId: config.usRoleId,
            name: "Us",
          },
        }[interaction.customId];

        if (!buttonConfig.roleId) {
          const reply = await interaction.followUp({
            content: `Cargo ${buttonConfig.name} não configurado!`,
            ephemeral: true
          });
          setTimeout(() => reply.delete().catch(() => {}), 60000);
          return;
        }

        const reply = await interaction.followUp({
          content: `Mencione o usuário que receberá o cargo de ${buttonConfig.name}`,
          ephemeral: true
        });
        setTimeout(() => reply.delete().catch(() => {}), 60000);

        if (interaction.channel instanceof TextChannel) {
          const collectorKey = `${interaction.user.id}-${interaction.customId}`;
          if (roleAssignmentCollectors.has(collectorKey)) {
            roleAssignmentCollectors.get(collectorKey).stop();
          }

          const collector = interaction.channel.createMessageCollector({
            filter: (m: Message) => m.author.id === interaction.user.id && m.mentions.users.size > 0,
            time: 30000,
            max: 1
          });

          roleAssignmentCollectors.set(collectorKey, collector);

          collector.on('collect', async (m: Message) => {
            try {
              const targetUser = m.mentions.users.first();
              if (targetUser) {
                await toggleRole(interaction, buttonConfig.roleId!, buttonConfig.name, targetUser.id);
                await m.delete().catch(() => {
                  log(`Não foi possível deletar a mensagem de menção`, "discord");
                });
              }
            } catch (error) {
              log(`Erro ao processar toggle role: ${error}`, "discord");
              const errorReply = await interaction.followUp({
                content: "Ocorreu um erro ao processar o cargo. Por favor, tente novamente.",
                ephemeral: true
              });
              setTimeout(() => errorReply.delete().catch(() => {}), 60000);
            }
          });

          collector.on('end', (collected, reason) => {
            roleAssignmentCollectors.delete(collectorKey);
            if (collected.size === 0 && reason === 'time') {
              interaction.followUp({
                content: "Tempo esgotado. Por favor, tente novamente.",
                ephemeral: true
              }).then(reply => {
                setTimeout(() => reply.delete().catch(() => {}), 60000);
              });
            }
          });
        }
        break;
      }

      case "ver-membros": {
        await handlePanelaMenu(interaction);
        break;
      }
    }
  } catch (error) {
    log(`Erro ao processar botão: ${error}`, "discord");
    const errorReply = await interaction.followUp({
      content: "Ocorreu um erro ao processar o botão. Por favor, tente novamente.",
      ephemeral: true
    });
    setTimeout(() => errorReply.delete().catch(() => {}), 60000);
  }
}