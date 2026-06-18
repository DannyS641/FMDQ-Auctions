<?php
declare(strict_types=1);

namespace App\Audit;

use App\Auth\AuthContext;
use App\Database;
use App\Support\Dates;
use App\Support\RequestId;
use App\Support\Uuid;

/**
 * Port of audit-service.ts appendAudit: writes an immutable audit row, stamping
 * the actor's role and (if signed in) user id into the details JSON.
 */
final class AuditService
{
    /** @param array<string,mixed> $details */
    public function append(
        AuthContext $ctx,
        string $eventType,
        string $entityType,
        string $entityId,
        array $details = []
    ): void {
        $details['actorRole'] = $ctx->role;
        if ($ctx->userId !== null) {
            $details['actorUserId'] = $ctx->userId;
        }

        $stmt = Database::pdo()->prepare(
            'INSERT INTO audits (id, event_type, entity_type, entity_id, actor, actor_type, request_id, details_json, created_at)
             VALUES (:id, :etype, :entype, :eid, :actor, :atype, :rid, :details, :created)'
        );
        $stmt->execute([
            ':id'      => Uuid::v4(),
            ':etype'   => $eventType,
            ':entype'  => $entityType,
            ':eid'     => $entityId,
            ':actor'   => $ctx->actor,
            ':atype'   => $ctx->actorType,
            ':rid'     => RequestId::get(),
            ':details' => json_encode($details, JSON_UNESCAPED_SLASHES),
            ':created' => Dates::nowUtc(),
        ]);
    }
}
