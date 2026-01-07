# Documentation API Chat - Endpoints `/list` et `/:chatId/messages`

## Vue d'ensemble

Cette documentation décrit deux endpoints de l'API Chat :
- `GET /chat/list` - Récupère la liste de tous les chats d'une organisation
- `GET /chat/:chatId/messages` - Récupère tous les messages d'un chat spécifique

## Authentification

Tous les endpoints nécessitent une authentification via clé API dans le header :
```
x-api-key: <votre-clé-api>
```

---

## `GET /chat/list`

### Description
Récupère tous les chats de l'organisation authentifiée, triés par date de mise à jour décroissante (plus récent en premier).

### Endpoint
```
GET /chat/list
```

### Headers
```
x-api-key: string (requis)
```

### Réponse

#### Succès (200 OK)

Retourne un tableau d'objets Chat avec le nombre de messages inclus.

**Format de réponse :**
```typescript
Array<{
  id: string;                    // UUID du chat
  title: string | null;          // Titre du chat (par défaut: "Nouvelle discussion")
  createdAt: string;             // Date de création (ISO 8601)
  updatedAt: string;             // Date de mise à jour (ISO 8601)
  organizationId: string;        // UUID de l'organisation
  projectId: string | null;       // UUID du projet associé (optionnel)
  metadata: object;              // Métadonnées du chat (JSON object)
  organization: {                 // Objet Organisation
    id: string;
    name: string;
    scope: string;
    createdAt: string;
    updatedAt: string;
    // ... autres champs
  };
  project: {                      // Objet Projet (peut être null)
    id: string;
    name: string;
    organizationId: string;
    // ... autres champs
  } | null;
  messagesLength: number;         // Nombre de messages dans le chat
}>
```

**Exemple de réponse :**
```json
[
  {
    "id": "b7e23a8b-8c4a-4e2a-9c1a-2f5e4d6a7b8c",
    "title": "Discussion sur le DTU 65.12",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-20T14:45:00.000Z",
    "organizationId": "org-123-456",
    "projectId": "proj-789-abc",
    "metadata": {
      "source": "web",
      "userAgent": "Mozilla/5.0..."
    },
    "organization": {
      "id": "org-123-456",
      "name": "Mon Organisation",
      "scope": "REGULAR",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    },
    "project": {
      "id": "proj-789-abc",
      "name": "Projet Résidentiel",
      "organizationId": "org-123-456",
      "createdAt": "2024-01-10T00:00:00.000Z",
      "updatedAt": "2024-01-10T00:00:00.000Z"
    },
    "messagesLength": 12
  },
  {
    "id": "a1f2e3d4-5c6b-7a8b-9c0d-1e2f3a4b5c6d",
    "title": "Nouvelle discussion",
    "createdAt": "2024-01-18T09:15:00.000Z",
    "updatedAt": "2024-01-19T16:20:00.000Z",
    "organizationId": "org-123-456",
    "projectId": null,
    "metadata": {},
    "organization": {
      "id": "org-123-456",
      "name": "Mon Organisation",
      "scope": "REGULAR",
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    },
    "project": null,
    "messagesLength": 5
  }
]
```

#### Erreurs

**401 Unauthorized**
```json
{
  "statusCode": 401,
  "message": "API Key invalide"
}
```

---

## `GET /chat/:chatId/messages`

### Description
Récupère tous les messages d'un chat spécifique, triés par date de création croissante (plus ancien en premier).

### Endpoint
```
GET /chat/:chatId/messages
```

### Paramètres d'URL
- `chatId` (string, requis) : UUID du chat dont on veut récupérer les messages

### Headers
```
x-api-key: string (requis)
```

### Réponse

#### Succès (200 OK)

Retourne un tableau d'objets ChatMessage avec tous les détails nécessaires pour la navigation dans l'arbre de conversation.

**Format de réponse :**
```typescript
Array<{
  id: string;                    // ID unique du message (CUID)
  chatId: string;                // UUID du chat parent
  role: "USER" | "ASSISTANT" | "SYSTEM" | "TOOL";  // Rôle du message
  content: string;               // Contenu textuel du message
  parts: Array<any>;             // Parties du message (JSON array, pour contenu multi-modal)
  metadata: object;              // Métadonnées du message (JSON object)
  message: object | null;        // Format UIMessage de Vercel AI SDK (peut être null pour anciens messages)
  createdAt: string;             // Date de création (ISO 8601)
  updatedAt: string;             // Date de mise à jour (ISO 8601)
  depth: number;                 // Profondeur dans l'arbre de conversation (0 = racine)
  previousMessageId: string | null;  // ID du message parent (null pour le premier message)
  rootMessageId: string | null;     // ID du message racine
  siblingIndex: number;          // Index parmi les frères/sœurs (0 = premier)
  accuracy: "POSITIVE" | "NEGATIVE" | "NOT_SPECIFIED" | null;  // Note de précision
  feedback: string | null;       // Commentaire de feedback
}>
```

**Exemple de réponse :**
```json
[
  {
    "id": "msg_abc123def456",
    "chatId": "b7e23a8b-8c4a-4e2a-9c1a-2f5e4d6a7b8c",
    "role": "USER",
    "content": "Qu'est-ce que le DTU 65.12 ?",
    "parts": [],
    "metadata": {},
    "message": {
      "id": "msg_abc123def456",
      "role": "user",
      "parts": [
        {
          "type": "text",
          "text": "Qu'est-ce que le DTU 65.12 ?"
        }
      ],
      "metadata": {
        "prismaMessageId": "msg_abc123def456",
        "messageId": "msg_abc123def456",
        "previousMessageId": null,
        "depth": 0,
        "siblingIndex": 0,
        "maxSiblingIndex": 0,
        "createdAt": "2024-01-15T10:30:00.000Z"
      }
    },
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z",
    "depth": 0,
    "previousMessageId": null,
    "rootMessageId": null,
    "siblingIndex": 0,
    "accuracy": null,
    "feedback": null
  },
  {
    "id": "msg_xyz789ghi012",
    "chatId": "b7e23a8b-8c4a-4e2a-9c1a-2f5e4d6a7b8c",
    "role": "ASSISTANT",
    "content": "Le DTU 65.12 est un document technique unifié qui traite de...",
    "parts": [],
    "metadata": {
      "model": "anthropic/claude-3.7-sonnet",
      "usage": {
        "inputTokens": 150,
        "outputTokens": 300,
        "totalTokens": 450
      }
    },
    "message": {
      "id": "msg_xyz789ghi012",
      "role": "assistant",
      "parts": [
        {
          "type": "text",
          "text": "Le DTU 65.12 est un document technique unifié qui traite de..."
        }
      ],
      "metadata": {
        "prismaMessageId": "msg_xyz789ghi012",
        "messageId": "msg_xyz789ghi012",
        "previousMessageId": "msg_abc123def456",
        "depth": 1,
        "siblingIndex": 0,
        "maxSiblingIndex": 0,
        "createdAt": "2024-01-15T10:30:15.000Z"
      }
    },
    "createdAt": "2024-01-15T10:30:15.000Z",
    "updatedAt": "2024-01-15T10:30:15.000Z",
    "depth": 1,
    "previousMessageId": "msg_abc123def456",
    "rootMessageId": null,
    "siblingIndex": 0,
    "accuracy": "POSITIVE",
    "feedback": "Très utile, merci !"
  }
]
```

#### Erreurs

**401 Unauthorized**
```json
{
  "statusCode": 401,
  "message": "API Key invalide"
}
```

**404 Not Found**
```json
{
  "statusCode": 404,
  "message": "Chat non trouvé"
}
```

Cela se produit si :
- Le `chatId` n'existe pas
- Le chat n'appartient pas à l'organisation authentifiée

---

## Notes importantes pour le frontend

### Structure arborescente des messages

Les messages sont organisés en arbre pour permettre les branches de conversation :
- `previousMessageId` : pointe vers le message parent (null pour le premier message)
- `depth` : profondeur dans l'arbre (0 = racine)
- `siblingIndex` : position parmi les frères/sœurs (0 = premier)
- `rootMessageId` : ID du message racine (peut être null)

### Format UIMessage

Le champ `message` contient le format UIMessage compatible avec Vercel AI SDK. Si ce champ est `null`, cela signifie que le message a été créé avant l'implémentation de ce format. Dans ce cas, utilisez les champs `content`, `role`, `parts`, etc. directement.

### Tri des messages

Les messages sont retournés triés par `createdAt` croissant (ordre chronologique). Pour reconstruire l'arbre de conversation, utilisez `previousMessageId` pour créer les relations parent-enfant.

### Exemple d'utilisation frontend

```typescript
// Récupérer la liste des chats
const response = await fetch('https://api.example.com/chat/list', {
  headers: {
    'x-api-key': 'votre-clé-api'
  }
});
const chats = await response.json();

// Récupérer les messages d'un chat
const chatId = chats[0].id;
const messagesResponse = await fetch(
  `https://api.example.com/chat/${chatId}/messages`,
  {
    headers: {
      'x-api-key': 'votre-clé-api'
    }
  }
);
const messages = await messagesResponse.json();

// Reconstruire l'arbre de conversation
const messageMap = new Map(messages.map(msg => [msg.id, msg]));
const rootMessages = messages.filter(msg => msg.previousMessageId === null);

function buildTree(messageId: string): MessageNode {
  const message = messageMap.get(messageId);
  const children = messages
    .filter(msg => msg.previousMessageId === messageId)
    .sort((a, b) => a.siblingIndex - b.siblingIndex);

  return {
    ...message,
    children: children.map(child => buildTree(child.id))
  };
}
```

---

## Codes de statut HTTP

| Code | Description |
|------|-------------|
| 200 | Succès - Données retournées |
| 401 | Non autorisé - Clé API invalide ou manquante |
| 404 | Non trouvé - Chat inexistant ou non accessible |
| 500 | Erreur serveur interne |

