// ============================================================
//  PANNEAU DE CHOIX — partagé entre le mode local et le mode en ligne
//  Transforme une requête ask({ kind, player, candidates, context })
//  en panneau à l'écran, et renvoie la réponse du joueur.
// ============================================================

/**
 * @param ui       l'interface (createUI)
 * @param scene    la scène 3D (pour cliquer sur les villageois)
 * @param req      { kind, player:{id,name,isMayor}, candidates:[ids], context }
 * @param lookup   (id) => { id, name, color }
 * @param seconds  temps limite affiché (mode en ligne), optionnel
 */
export async function showAskPanel({ ui, scene, req, lookup, seconds = null }) {
  const { kind, player: p, context: ctx = {} } = req;
  const n = (id) => lookup(id)?.name ?? '—';
  const deadline = seconds ? Date.now() + seconds * 1000 : null;

  const pickOne = async (opts) => {
    scene.setSelectable(req.candidates);
    try {
      return await ui.choose({ ...opts, deadline, candidates: req.candidates.map(lookup), onSelect: (id) => scene.setSelected(id) });
    } finally { scene.setSelectable(null); scene.setSelected(null); }
  };

  switch (kind) {
    case 'role-reveal':
      await ui.roleCard(ctx.role, { mates: ctx.mates ?? [] });
      return true;
    case 'wolf-target': {
      const mates = (ctx.pack ?? []).filter(id => id !== p.id).map(n);
      const prior = Object.entries(ctx.votesSoFar ?? {}).filter(([, t]) => t).map(([w, t]) => `${n(w)} → ${n(t)}`);
      return pickOne({
        title: `🐺 ${p.name}, choisis la victime de la meute`,
        sub: [mates.length ? `Ta meute : ${mates.join(', ')}` : 'Tu chasses seul cette nuit.', prior.length ? `Déjà choisi : ${prior.join(', ')}` : ''].filter(Boolean).join(' · '),
        confirmLabel: 'Dévorer',
      });
    }
    case 'seer-target':
      return pickOne({ title: `🔮 ${p.name}, qui veux-tu sonder ?`, sub: 'Tu découvriras son vrai rôle.', confirmLabel: 'Sonder' });
    case 'seer-result':
      await ui.roleCard(ctx.role, { heading: 'Vision de la Voyante', subject: n(ctx.targetId), button: 'Refermer les yeux' });
      return true;
    case 'witch-save':
      return ui.choose({
        deadline,
        title: `🧪 Les loups ont attaqué ${n(ctx.victimId)}${ctx.victimId === p.id ? ' (c\'est toi !)' : ''}`,
        sub: 'Utiliser ta potion de vie pour la sauver ? (une seule fois par partie)',
        boolean: { yes: '💚 Sauver', no: 'Laisser faire', cls: 'witch' },
      });
    case 'witch-poison':
      return pickOne({ title: '☠️ Potion de mort', sub: `${ctx.victimId ? `${n(ctx.victimId)} va mourir. ` : ''}Veux-tu aussi empoisonner quelqu'un ?`, noneLabel: 'Ne rien faire', confirmLabel: 'Empoisonner' });
    case 'vote':
      return pickOne({ title: `🗳️ ${p.name}, qui veux-tu éliminer ?`, sub: p.isMayor ? 'Ta voix de maire compte double.' : 'Le joueur qui reçoit le plus de voix est éliminé.', noneLabel: 'S\'abstenir', confirmLabel: 'Voter' });
    case 'mayor-vote':
      return pickOne({ title: `🎖️ ${p.name}, qui doit devenir maire ?`, sub: 'Tu peux voter pour toi-même.', confirmLabel: 'Voter' });
    case 'mayor-tiebreak':
      return pickOne({ title: `⚖️ Égalité ! ${p.name}, tranche en tant que maire`, sub: 'Le joueur que tu désignes est éliminé.', confirmLabel: 'Trancher' });
    case 'hunter-shot':
      return pickOne({ title: `🏹 ${p.name}, ta dernière flèche`, sub: 'Choisis qui tu emportes avec toi.', confirmLabel: 'Tirer' });
    case 'mayor-successor':
      return pickOne({ title: `🎖️ ${p.name}, transmets ton écharpe`, sub: 'Désigne le nouveau maire.', confirmLabel: 'Désigner' });
    default:
      return pickOne({ title: kind });
  }
}
