export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAuth } from "@/lib/auth/auth"
import { success, badRequest, notFound, serverError, forbidden } from "@/lib/api-response";
import type { MatchWithProfiles } from "@/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    

    const { user } = await requireAuth();
    const { id } = await params;

    const match = await db.match.findUnique({
      where: { id },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            image: true,
            profile: {
              select: {
                id: true,
                displayName: true,
                age: true,
                gender: true,
                genderIdentity: true,
                sexuality: true,
                bio: true,
                avatar: true,
                city: true,
                country: true,
                relationshipGoal: true,
                attachmentStyle: true,
                communicationStyle: true,
                conflictResolution: true,
                loveLanguage: true,
                boundaries: true,
                dealbreakers: true,
                lifePriorities: true,
                emotionalAvailability: true,
                preferredAgeMin: true,
                preferredAgeMax: true,
                preferredGender: true,
                preferredDistance: true,
              },
            },
          },
        },
        receiver: {
          select: {
            id: true,
            name: true,
            image: true,
            profile: {
              select: {
                id: true,
                displayName: true,
                age: true,
                gender: true,
                genderIdentity: true,
                sexuality: true,
                bio: true,
                avatar: true,
                city: true,
                country: true,
                relationshipGoal: true,
                attachmentStyle: true,
                communicationStyle: true,
                conflictResolution: true,
                loveLanguage: true,
                boundaries: true,
                dealbreakers: true,
                lifePriorities: true,
                emotionalAvailability: true,
                preferredAgeMin: true,
                preferredAgeMax: true,
                preferredGender: true,
                preferredDistance: true,
              },
            },
          },
        },
        chatRoom: true,
      },
    });

    if (!match) {
      return notFound("Match not found");
    }

    // Check if user is part of this match
    if (match.senderId !== user.id && match.receiverId !== user.id) {
      // Allow admins to view any match
      if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
        return forbidden("You don't have access to this match");
      }
    }

    return success(match);
  } catch (error) {
    console.error("Error fetching match:", error);
    return serverError("Failed to fetch match");
  }
}

const updateMatchSchema = z.object({
  action: z.enum(["INTERESTED", "PASS", "MAYBE", "BLOCK"]).optional(),
  reviewNotes: z.string().optional(),
  reviewedBy: z.string().optional(),
  status: z.enum(["PENDING", "ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"]).optional(),
});

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    

    const { user } = await requireAuth();
    const { id } = await params;
    const body = await request.json();

    const parseResult = updateMatchSchema.safeParse(body);
    if (!parseResult.success) {
      return badRequest("Invalid request body", parseResult.error.issues);
    }

    const { action, reviewNotes, reviewedBy, status } = parseResult.data;

    const match = await db.match.findUnique({
      where: { id },
    });

    if (!match) {
      return notFound("Match not found");
    }

    // Handle match reaction
    if (action) {
      // Check if user is part of this match
      const isSender = match.senderId === user.id;
      const isReceiver = match.receiverId === user.id;

      if (!isSender && !isReceiver) {
        return forbidden("You don't have access to this match");
      }

      // Update the appropriate action field
      const updateData: Record<string, unknown> = {
        ...(isSender ? { senderAction: action } : {}),
        ...(isReceiver ? { receiverAction: action } : {}),
      };

      // Check for mutual acceptance
      const currentSenderAction = isSender ? action : match.senderAction;
      const currentReceiverAction = isReceiver ? action : match.receiverAction;

      if (currentSenderAction === "INTERESTED" && currentReceiverAction === "INTERESTED") {
        // Mutual interest - create chat room and update status
        const chatRoom = await db.chatRoom.create({
          data: {
            matchId: match.id,
            members: {
              create: [
                { userId: match.senderId },
                { userId: match.receiverId },
              ],
            },
          },
        });

        updateData.status = "ACCEPTED";
        updateData.chatRoom = { connect: { id: chatRoom.id } };

        // Create notifications for both users
        await db.notification.createMany({
          data: [
            {
              userId: match.senderId,
              type: "MATCH_ACCEPTED",
              title: "匹配成功！",
              body: "你们互相喜欢！现在可以开始聊天了",
              data: JSON.stringify({ matchId: match.id, chatRoomId: chatRoom.id }),
            },
            {
              userId: match.receiverId,
              type: "MATCH_ACCEPTED",
              title: "匹配成功！",
              body: "你们互相喜欢！现在可以开始聊天了",
              data: JSON.stringify({ matchId: match.id, chatRoomId: chatRoom.id }),
            },
          ],
        });
      } else if (action === "BLOCK" || (currentSenderAction === "BLOCK" || currentReceiverAction === "BLOCK")) {
        // Block or mutual pass
        updateData.status = "REJECTED";
      } else if (action === "PASS") {
        // If one person passes, the match is rejected
        updateData.status = "REJECTED";
      }

      const updatedMatch = await db.match.update({
        where: { id },
        data: updateData,
        include: {
          sender: {
            select: {
              id: true,
              name: true,
              image: true,
              profile: {
                select: {
                  id: true,
                  displayName: true,
                  age: true,
                  gender: true,
                  avatar: true,
                  city: true,
                },
              },
            },
          },
          receiver: {
            select: {
              id: true,
              name: true,
              image: true,
              profile: {
                select: {
                  id: true,
                  displayName: true,
                  age: true,
                  gender: true,
                  avatar: true,
                  city: true,
                },
              },
            },
          },
          chatRoom: true,
        },
      });

      return success(updatedMatch);
    }

    // Handle admin review updates
    if (reviewNotes !== undefined || reviewedBy !== undefined || status !== undefined) {
      // Check if user is admin
      if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
        return forbidden("Admin access required for review updates");
      }

      const updatedMatch = await db.match.update({
        where: { id },
        data: {
          ...(reviewNotes !== undefined && { reviewNotes }),
          ...(reviewedBy !== undefined && { reviewedBy }),
          ...(status !== undefined && { status }),
        },
      });

      return success(updatedMatch);
    }

    return badRequest("No valid update fields provided");
  } catch (error) {
    console.error("Error updating match:", error);
    return serverError("Failed to update match");
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    

    const { user } = await requireAuth();
    const { id } = await params;

    const match = await db.match.findUnique({
      where: { id },
    });

    if (!match) {
      return notFound("Match not found");
    }

    // Only admins can delete/cancel matches
    if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") {
      return forbidden("Admin access required to cancel matches");
    }

    // Get cancellation reason from query params
    const { searchParams } = new URL(request.url);
    const reason = searchParams.get("reason");

    await db.match.update({
      where: { id },
      data: {
        status: "CANCELLED",
        reviewNotes: reason || "Cancelled by admin",
        reviewedBy: user.id,
      },
    });

    return success({ message: "Match cancelled successfully" });
  } catch (error) {
    console.error("Error cancelling match:", error);
    return serverError("Failed to cancel match");
  }
}
