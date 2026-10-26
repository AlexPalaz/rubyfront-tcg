# frozen_string_literal: true

require "json"
require "tmpdir"
require "fileutils"
require "minitest/autorun"
require_relative "../lib/rubyfront/card_index"

# L'anagrafe letta dai dati veri del repo: se questi test si rompono, o è
# cambiato lo schema delle carte o è cambiato il posto dei dati.
class CardIndexTest < Minitest::Test
  DATA_DIR = File.expand_path("../../data", __dir__)

  def setup
    @index = Rubyfront::CardIndex.load(DATA_DIR)
  end

  # Il debito dichiarato della regola d'oro (§1.1): i trigger delle carte
  # che NESSUNA forma certificata legge ancora. Ogni carta collegata toglie
  # la sua voce; un trigger che sparisce da qui senza una forma nuova, o che
  # vi compare, è una forma rotta o un dato cambiato di nascosto — e il test
  # lo dice forte, prima che l'effetto svanisca in silenzio dal tavolo.
  DEBT = [
    # Vuoto dal 2026-10-22: le forme dello starter Umani sono certificate dal
    # 2026-10-20 (engine 0.89.0), quelle dello starter Auros — la Stasi
    # imposta o tolta, il buff secco in Reazione, i PV a ogni Stasi, la
    # ricerca di Oggetti, l'esilio a tempo — dal 2026-10-22 (engine 0.91.0),
    # e le otto della scheda riletta il 2026-10-23 (lo sguardo e il riordino
    # della cima all'ingresso, i PV agli ingressi e alle tappate, «hanno
    # Stasi», il conto delle tappate, la sentenza del dado, la ricerca in
    # Ritiro) dal 2026-10-23 (engine 0.92.0).
  ].freeze

  def test_every_trigger_has_form_or_is_declared_debt
    unknowns = Rubyfront::CardIndex.unknown_triggers(DATA_DIR)
    broken = unknowns - DEBT
    assert_empty broken, "trigger che nessuna forma legge più (forma rotta o dato cambiato): #{broken.join(", ")}"
    settled = DEBT - unknowns
    assert_empty settled, "trigger ormai riconosciuti: toglierli dal DEBT: #{settled.join(", ")}"
  end

  def test_certified_triggers_are_recognized
    # La forma della pesca all'attacco, scritta qui (dal 2026-09-17 nessuna carta la porta più).
    trigger = { "id" => "scouting", "event" => "on_attack", "details" => { "oncePerEachOfYourTurns" => true, "requiresObjectAssigned" => true },
                "effect" => { "type" => "draw_card", "target" => { "controller" => "controller" }, "count" => 1, "details" => { "thenDiscardCards" => 1 } } }
    assert Rubyfront::CardIndex.recognized?(trigger)
    # Lo stesso trigger con lo scarto a 2 esce dalla forma: ignoto, non frainteso.
    other_card = Marshal.load(Marshal.dump(trigger))
    other_card["effect"]["details"] = { "thenDiscardCards" => 2 }
    refute Rubyfront::CardIndex.recognized?(other_card)
  end

  # §3.1 — ogni Rubyfront del set stampa i suoi PV, e l'anagrafe li legge.
  def test_every_rubyfront_has_printed_hp
    rubyfronts = @index.select { |_, card| card[:type] == "rubyfront" }
    refute_empty rubyfronts
    rubyfronts.each do |id, card|
      assert card[:health].is_a?(Integer) && card[:health].positive?, "il Rubyfront #{id} non ha PV stampati leggibili"
    end
  end

  def test_reads_the_set
    refute_empty @index, "nessuna carta trovata in #{DATA_DIR}"
  end

  def test_knows_rallier_with_surge
    card = @index["RBF-009"]
    refute_nil card, "RBF-009 manca dall'anagrafe"
    assert_equal "entity", card[:type]
    assert_includes card[:keywords], "surge"
  end

  def test_ignores_local_text_files
    # I *.it.json e *.en.json non hanno "id" di carta o non rispettano il
    # nome della cartella: nessuna chiave dell'indice deve essere nil o vuota.
    assert @index.keys.all? { |id| id.is_a?(String) && !id.empty? }
  end

  def test_missing_folder_gives_empty_index
    assert_empty Rubyfront::CardIndex.load("/posto/che/non/esiste")
  end

  # --- gli ascoltatori d'ingresso certificati (§8.2) ----------------------

  def test_guide_listens_to_human_entries
    listeners = @index["RBF-003"][:enter_listeners]
    assert_equal 1, listeners.size
    assert_equal({ entering_race: "human", requires: { count: 3, race: "human" }, draw: 1 }, listeners.first)
    assert_equal [], @index["RBF-004"][:enter_listeners], "un on_attack non è un ascoltatore d'ingresso"
    assert_equal [], @index["RBF-007"][:enter_listeners], "un move_card all'ingresso non è la forma certificata"
  end

  def test_archer_exiles_to_abyss_and_retire_move_stays_readable
    # Dal 2026-09-04 l'Arciere esilia nell'Abisso «finché resta in campo»
    # (revisione del foglio del designer): dal 2026-09-06 è la forma
    # certificata dell'esilio condizionato all'ingresso.
    # Dal 2026-09-16 il bersaglio ha il vincolo di costo («con costo di Flusso 3 o inferiore»).
    assert_equal [{ target: { type: "entity", controller: "opponent", max_cost: 3 }, to: "abisso", hold: true }], @index["RBF-007"][:enter_moves]
    form_hash = { "target" => { "cardType" => "entity", "controller" => "opponent", "zone" => "front", "owner" => "opponent", "min" => 1, "max" => 1 },
              "destination" => { "zone" => "retire" } }
    plain = Rubyfront::CardIndex.enter_moves([{ "triggers" => [{ "event" => "on_enter_field", "effect" => form_hash.merge("type" => "move_card") }] }]).first
    assert_equal({ target: { type: "entity", controller: "opponent", max_cost: nil }, to: "ritiro" }, plain, "la forma resta leggibile, anche senza una carta che la porti")
    odd = form_hash.merge("target" => form_hash["target"].merge("conditions" => [{ "stat" => "power", "operator" => "lte", "value" => 2 }]))
    assert_equal [], Rubyfront::CardIndex.enter_moves([{ "triggers" => [{ "event" => "on_enter_field", "effect" => odd.merge("type" => "move_card") }] }]), "una condizione che non è il costo rende la forma ignota"
    assert_equal [], @index["RBF-003"][:enter_moves], "un ascoltatore non è uno spostamento di chi entra"
    assert_equal [], @index["RBF-012"][:enter_moves], "dalla propria Zona di Ritiro al Fronte è un'altra forma"
  end

  def test_returner_brings_static_card_back_from_retire_zone
    # Solo «quando attacca» (decisione del designer, 2026-09-04): l'innesco
    # d'ingresso è stato tolto dalla carta.
    form_hash = [{ from: "ritiro", filter: { static: true }, to: "field" }]
    assert_equal form_hash, @index["RBF-012"][:attack_returns]
    assert_equal [], @index["RBF-012"][:enter_returns], "non più all'ingresso"
    assert_equal [], @index["RBF-012"][:attack_draws], "il ritorno riporta, non pesca"
  end

  def test_on_attack_forms_of_real_cards
    forms_of = ->(id) { @index[id][:attack_forms].map { |form| [form[:kind], form[:who], form[:face]] } }
    assert_equal [], forms_of.call("RBF-028"), "dal 2026-09-17 (bilanciamento) niente stappata dopo il combattimento"
    assert_equal [["empower", "self", 0]], forms_of.call("RBF-029")
    assert_equal "one_armed", @index["RBF-029"][:attack_forms][0][:targets], "una sola armata, con la mira (dal 2026-09-17)"
    assert_equal [["empower", "object", 0], ["stash", "object", 0]], forms_of.call("RBF-034"), "dal 2026-09-15 lo sguardo lascia il posto a «un altro Oggetto in Ritiro, poi pesca»"
    assert_equal [["rearm", "ally", 0], ["look", "ally", 0]], forms_of.call("RBF-031")
    assert_equal [["heal", "self", 0]], forms_of.call("RBF-008")
    assert_equal [["return", "self", 0]], forms_of.call("RBF-010")
    assert_equal [["untap", "self", 0]], forms_of.call("RBF-011"), "dal 2026-09-15 la stappata di tutte torna all'attacco, col d20"
    assert_equal [["heal", "static", 0]], forms_of.call("RBF-022")
    assert_equal [["heal", "rubyfront", 0], ["heal", "rubyfront", 1]], forms_of.call("RBF-001")
    assert_equal [["empower", "self", 0]], forms_of.call("RBF-004"), "dal 2026-09-09 «se almeno 2 Umani attaccano» è il divieto di blocco di questo turno"
    assert_equal [], forms_of.call("RBF-005"), "dal 2026-09-08 non ha più inneschi d'attacco: è uno statico"
    # I dettagli che contano: dadi, soglie, destinazioni, seguiti.
    assert_equal({ die: 6, on_roll: [3, 6], other: true, then_draw: 1 }, @index["RBF-034"][:attack_forms][1].slice(:die, :on_roll, :other, :then_draw))
    assert_equal 2, @index["RBF-034"][:flux_cost], "dal 2026-09-15 costa 2"
    assert_equal({ once: true, count: 3, reveal_to: "ritiro", rest_to: "deck" }, @index["RBF-031"][:attack_forms][1].slice(:once, :count, :reveal_to, :rest_to))
    assert_equal({ amount: 2, die: 6, on_roll: [5, 6] }, @index["RBF-008"][:attack_forms][0].slice(:amount, :die, :on_roll))
    assert_equal [], @index["RBF-011"][:enter_refreshes], "dal 2026-09-15 nessuna stappata all'ingresso"
    assert_equal({ targets: "all", die: 20, on_roll: [15, 20] }, @index["RBF-011"][:attack_forms][0].slice(:targets, :die, :on_roll), "quando attacca, col d20 stappa tutte dopo la Fase di Fronte")
    assert_equal({ gain_on: [1, 6], drain_on: [15, 20], once: false }, @index["RBF-022"][:attack_forms][0].slice(:gain_on, :drain_on, :once), "a ogni Umano che attacca, dal 2026-09-14 (prima una volta per turno)")
    assert_equal({ requires_attackers: { count: 2, race: "human" }, targets: "opposing_entity", restrict: "block" }, @index["RBF-004"][:attack_forms][0].slice(:requires_attackers, :targets, :restrict), "conta gli attaccanti di questo turno, non del precedente")
    assert_equal [0, 1], @index["RBF-001"][:attack_forms].map { |form| form[:then_draw] }, "solo il Nexus pesca"
  end

  # --- gli statici, le Materie e il flip di Eredità Perduta (§8.2, §7.2, §3.1) --

  def test_special_abilities_of_real_rubyfronts
    human_rf = @index["RBF-001"][:abilities]
    assert_equal %w[glade-call charge-order heir-step return-to-front], human_rf.map { |a| a[:id] }, "dal 2026-09-08 il Nexus ha due abilità"
    assert_equal({ id: "glade-call", face: 0, timing: %w[preparazione fronte], cost: nil, gain: 1, fury: true,
                   form: { kind: "look", count: 3, reveal: { type: "entity", race: "human" } } }, human_rf[0])
    assert_equal({ kind: "power", amount: 1, targets: "all", race: "human", attacking: true, armed: false }, human_rf[1][:form])
    assert_equal 5, human_rf[1][:cost]
    assert_equal({ kind: "discount", amount: 1, type: "entity", race: "human" }, human_rf[2][:form])
    assert_equal 2, human_rf[2][:gain], "dal 2026-09-13 le abilità che danno PV ne danno 2"
    assert_equal [1, 1], human_rf[2..3].map { |a| a[:face] }
    assert_equal({ kind: "summon", race: "human", grants: ["surge"], bonus: { amount: 1, race: "human" }, max_cost: nil }, human_rf[3][:form],
                 "«metti sul tuo Fronte un Umano dalla mano senza costo, con Slancio; +1 alle prossime attaccanti» è la chiamata sul Fronte")
    assert_equal 7, human_rf[3][:cost]
    assert_equal({ 0 => 13 }, @index["RBF-001"][:fury_at], "la Furia solo sulla faccia del Rubyfront, a 13")
    object_rf = @index["RBF-023"][:abilities]
    assert_equal %w[swift-forge calibrated-strike deep-forge blade-chorus], object_rf.map { |a| a[:id] }, "dal 2026-09-10 senza il riarmo"
    assert_equal({ kind: "discount", amount: 1, type: "object", race: nil }, object_rf[0][:form])
    assert_equal %w[preparazione], object_rf[0][:timing]
    assert_equal [nil, 1], [object_rf[0][:cost], object_rf[0][:gain]], "sul Rubyfront lo sconto sugli Oggetti dà 1 PV (dal 2026-09-14)"
    assert_equal [nil, 2], [object_rf[2][:cost], object_rf[2][:gain]], "sul Nexus la forgia dà 2 PV (dal 2026-09-14; prima costava 3)"
    assert_equal({ kind: "power", amount: 2, targets: "one", race: nil, attacking: false, armed: true }, object_rf[1][:form])
    assert_equal({ kind: "power", amount: 2, targets: "all", race: nil, attacking: false, armed: true }, object_rf[3][:form])
    assert_equal 5, object_rf[3][:cost], "Coro delle Lame: −5 PV, +2 dal 2026-09-10"
    assert_equal({ 0 => 12 }, @index["RBF-023"][:fury_at])
    assert_equal [], @index["RBF-002"][:abilities], "un'Entità non ha abilità speciali"
  end

  def test_power_statics_of_real_cards
    assert_equal [{ kind: "self_power", amount: 1, while_attacking: true, requires_other: { type: "entity", race: "human" } }], @index["RBF-002"][:static_forms]
    assert_equal [{ kind: "self_power", amount: 1, per_other: { type: "entity", race: "human" } }], @index["RBF-010"][:static_forms]
    assert_equal [{ kind: "bearer_power", amount: 1 }], @index["RBF-013"][:static_forms], "il +1 dell'Oggetto; la Stasi sta nelle concessioni"
    assert_equal [{ kind: "bearer_power", amount: 1, per: { type: "entity", race: "human" }, multi_block: true }], @index["RBF-014"][:static_forms]
    assert_equal [{ kind: "self_counter", amount: 1, per_object: true }], @index["RBF-028"][:static_forms], "dal 2026-09-10 il Contrattacco per Oggetto"
    assert_nil @index.values.find { |c| Array(c[:static_forms]).any? { |f| f[:kind] == "flux_toll" } }, "la tassa di Flusso resta certificata, oggi senza carte"
    assert_equal [{ kind: "never_taps" }], @index["RBF-011"][:static_forms], "«questa Entità non si tappa mai»"
    assert_equal [{ kind: "never_taps" }], @index["RBF-005"][:static_forms], "dal 2026-09-08 anche il 2 Flussi non si tappa attaccando"
    assert_equal [{ kind: "others_armed_power", amount: 1 }], @index["RBF-031"][:static_forms], "«+1 alle altre armate» certificato dal 2026-09-10"
    # Dal 2026-09-10: «se ha un Oggetto assegnato, +1» e gli Oggetti «mentre assegnato» senza durata esplicita.
    assert_equal [{ kind: "self_power", amount: 1, while_armed: true }], @index["RBF-024"][:static_forms], "dal 2026-09-17 «armata +1» accanto allo scarto d'Oggetto all'ingresso"
    assert_equal [{ kind: "bearer_power", amount: 1 }], @index["RBF-032"][:static_forms]
    assert_equal [{ kind: "bearer_power", amount: 1 }], @index["RBF-033"][:static_forms], "+1 Potenza al portatore (via il Contrattacco dal 2026-09-17)"
    assert_equal [{ kind: "bearer_power", amount: 2 }], @index["RBF-035"][:static_forms], "il ritorno in Ritiro resta nel debito"
  end

  # Dal 2026-09-15: lo scarto d'Oggetto all'ingresso e all'attacco, il ritiro a pagamento.
  def test_object_stash_and_paid_retire
    assert_equal [{ from: "hand", type: "object", to: "ritiro", then_draw: 1 }], @index["RBF-024"][:enter_stashes]
    assert_equal [], @index["RBF-032"][:self_retires], "dal 2026-09-17 la Spada si riassegna dal Ritiro pagando (forma non certificata), non si ritira più"
    assert_equal [], @index["RBF-032"][:abilities], "l'azione di un Oggetto non è un'abilità del Rubyfront"
    assert_equal [], @index["RBF-034"][:enter_stashes]
    assert_equal [], @index["RBF-033"][:self_retires], "solo chi lo stampa si mette in Ritiro pagando"
  end

  # Dal 2026-09-10: il disarmo con riarmo all'ingresso e il ritorno vincolato.
  def test_disarm_rearm_and_bound_return
    assert_equal [{ to: "ritiro" }], @index["RBF-046"][:enter_disarms]
    assert_equal [{ any: true }], @index["RBF-046"][:enter_rearms]
    assert_equal [], @index["RBF-046"][:enter_moves], "gli Oggetti avversari in Ritiro non sono lo spostamento di un'Entità"
    assert_equal [], @index["RBF-025"][:enter_disarms]
    assert_equal [], @index["RBF-012"][:enter_rearms], "dal Ritiro al Fronte è un'altra forma"
    assert_equal [{ max_cost: 2 }], @index["RBF-045"][:leave_returns], "dal 2026-09-17 (bilanciamento) torna con un Oggetto fino al costo 2"
    assert_equal [], @index["RBF-007"][:leave_returns], "il ritorno di chi è stato esiliato non è il ritorno vincolato"

    # Il riarmo che costa, o su un'Entità sola, esce dalla forma: ignoto.
    card = JSON.parse(File.read(File.join(DATA_DIR, "sets", "srbf-001", "cards", "rbf-046", "rbf-046.json")))
    rearm = card["faces"].flat_map { |face| face["triggers"] }.find { |t| t["id"] == "rearm" }
    pricey = Marshal.load(Marshal.dump(rearm))
    pricey["effect"]["details"]["noFluxCost"] = false
    refute Rubyfront::CardIndex.recognized?(pricey)
    # Il ritorno vincolato senza il vincolo «senza Oggetti» non è certificato.
    card = JSON.parse(File.read(File.join(DATA_DIR, "sets", "srbf-001", "cards", "rbf-045", "rbf-045.json")))
    comeback = card["faces"].flat_map { |face| face["triggers"] }.find { |t| t["id"] == "bound-return" }
    unbound = Marshal.load(Marshal.dump(comeback))
    unbound["details"].delete("requiresNoObjectAssignedWhenLeft")
    refute Rubyfront::CardIndex.recognized?(unbound)
  end

  def test_first_deck_matters_at_resolution
    forms_of = ->(id) { @index[id][:resolve_forms] }
    assert_equal [{ kind: "look", count: 4, reveal: { type: "entity", race: "human" }, reveal_to: "hand", rest_to: "deck", show_up_to: 2 }], forms_of.call("RBF-015")
    assert_equal [{ kind: "empower", targets: "own_entity", race: "human", power: 1, untap: true }], forms_of.call("RBF-016")
    assert_equal [{ kind: "move", target: { type: "entity", controller: "opponent", max_cost: 2 }, to: "ritiro", discount: nil }], forms_of.call("RBF-017")
    assert_equal [{ kind: "exile", target: { static: true, controller: "opponent" }, to: "abisso", hold: true }], forms_of.call("RBF-018")
    assert_equal [{ kind: "fortune", die: 20, gain: { on: [1, 6], amount: 4 }, deploy: { on: [7, 13], filter: { type: "entity", race: "human", max_cost: 2 } },
                    draw: { on: [14, 19], count: 1 }, all_on: [20, 20] }], forms_of.call("RBF-019")
    assert_equal [{ kind: "empower", targets: "own_entities", race: "human", counter: 1, untap: true, requires: { count: 3, race: "human" } }], forms_of.call("RBF-020"), "la stappata di gruppo: in Reazione, senza bloccare"
    assert_equal [{ kind: "destroy", target: { type: "entity", controller: "any" }, to: "abisso", discount: { amount: 3, if_target: "tapped" }, then_lose: nil }], forms_of.call("RBF-021")
    assert_equal [{ kind: "destroy", target: { type: "entity", controller: "opponent" }, to: "abisso", discount: { amount: 1, if_target: "tapped" }, then_lose: nil }], forms_of.call("RBF-038"), "dal 2026-09-17 niente PV persi, sconto sulla tappata"
    assert_equal [{ kind: "drain", amount: "objects" }], forms_of.call("RBF-042"), "il Rubyfront/Nexus avversario perde PV pari agli Oggetti assegnati"
    assert_equal [{ kind: "search", count: 6, die: 20, bands: { "matter" => [1, 5], "object" => [6, 13], "entity" => [14, 20] }, reveal_to: "hand", if_no_reveal_top: true, then_retire: true, rest_to: "deck" }], forms_of.call("RBF-041"), "la ricerca col dado"
    assert_equal [{ kind: "ends", face: 0, swap: true, then_draw: 1, then_discard: 1, once: true }, { kind: "ends", face: 1, to_hand: true, other_to_retire: true, once: true }], @index["RBF-023"][:assign_forms], "gli estremi del mazzo, per faccia"
    assert_equal [], @index["RBF-035"][:death_forms], "dal 2026-09-17 (bilanciamento) niente riarmo alla morte"
    assert_equal [], @index["RBF-043"][:death_forms]
  end

  def test_second_deck_matters_at_resolution
    forms_of = ->(id) { @index[id][:resolve_forms] }
    assert_equal [{ kind: "empower", targets: "own_armed", power: 1, up_to: 2, untap: true }], forms_of.call("RBF-036"), "fino a 2 armate (dal 2026-09-17, bilanciamento), +1 e stappate"
    assert_equal [{ kind: "weaken", target: { type: "entity", controller: "opponent", attacking: true }, amount: -1, per_armed: true }], forms_of.call("RBF-039"), "l'attaccante avversario, −1 per armata"
    assert_equal [{ kind: "move", target: { type: "entity", controller: "opponent", max_cost: nil }, to: "ritiro", discount: { amount: 1, if_armed_at_least: 2 } }], forms_of.call("RBF-044"), "in Ritiro, con 2 armate costa 1 in meno (dal 2026-09-17, bilanciamento)"
    assert_equal [{ kind: "exile", target: { type: "entity", controller: "opponent" }, to: "abisso", hold: true }], @index["RBF-043"][:assign_forms], "«quando assegni»: l'esilio tenuto dall'Oggetto"
    assert_equal [], @index["RBF-018"][:assign_forms], "una Materia non ha inneschi d'assegnazione"
    assert_equal [{ kind: "draw", count: 1, to_self: true }], @index["RBF-030"][:assign_forms], "«quando assegni un Oggetto a questa Entità: pesca»"
    assert_equal [{ kind: "assign_discount", amount: 1 }], @index["RBF-030"][:static_forms], "«gli Oggetti che assegni a questa Entità costano 1 in meno»"
    assert_equal [{ kind: "others_armed_power", amount: 1 }], @index["RBF-031"][:static_forms], "«le altre Entità con un Oggetto assegnato che controlli hanno +1»"
    # Un dettaglio in più rende la forma ignota, mai fraintesa.
    trigger = lambda do |id, trigger_id|
      card = JSON.parse(File.read(File.join(DATA_DIR, "sets", "srbf-001", "cards", id.downcase, "#{id.downcase}.json")))
      Marshal.load(Marshal.dump(card["faces"].flat_map { |face| face["triggers"] }.find { |t| t["id"] == trigger_id }))
    end
    fracture = trigger.call("RBF-044", "sunder")
    fracture["effect"]["details"]["fluxCostReduction"]["ifTargetState"] = "tapped"
    refute Rubyfront::CardIndex.recognized?(fracture)
    refraction = trigger.call("RBF-039", "refract")
    refraction["effect"]["amount"] = 1
    refute Rubyfront::CardIndex.recognized?(refraction), "un +1 non è l'indebolimento"
    prism = trigger.call("RBF-043", "confine")
    prism["details"] = {}
    refute Rubyfront::CardIndex.recognized?(prism), "senza «è questo Oggetto che viene assegnato» la forma non entra"
    assert_equal [], forms_of.call("RBF-022"), "la Statica si innesca all'attacco, non alla risoluzione"
  end

  def test_human_rubyfront_nexus_and_its_flip
    assert_equal({ face: 1, conditions: [{ count: 4, type: "entity", race: "human" }], discard: { count: 1, type: "entity" }, retire: nil, recovery: 3 }, @index["RBF-001"][:nexus], "recupero al flip +3 PV dal 2026-09-13")
    assert_equal [{ kind: "move", card_id: "RBF-012", from: "field", to: "abisso" }, { kind: "seal", card_id: "RBF-012" }], @index["RBF-001"][:flip_forms]
    assert_equal({ face: 1, conditions: [{ count: 3, type: "entity", race: nil, armed: true }], discard: { count: 1, type: nil }, retire: nil, recovery: 3 }, @index["RBF-023"][:nexus], "dal 2026-09-10: «con un Oggetto assegnato», scarta una carta")
    assert_equal %w[move seal draw], @index["RBF-023"][:flip_forms].map { |form| form[:kind] }, "ma i suoi «quando flippa» hanno la stessa forma, più la pesca"
    assert_equal({ kind: "draw", count: 1 }, @index["RBF-023"][:flip_forms].last)
    assert_nil @index["RBF-004"][:nexus]
  end

  # --- Le forme dello starter Umani (dal 2026-10-20) ---------------------

  def test_starter_entry_forms_enter_tapped_and_empower_another
    assert_equal [{ kind: "self_tap" }], @index["RBF-048"][:enter_taps]
    assert_equal [], @index["RBF-047"][:enter_taps], "una vanilla non entra tappata"
    assert_equal [{ targets: "other_own_entity", race: nil, power: 1 }], @index["RBF-050"][:enter_empowers]
    assert_equal [], @index["RBF-048"][:enter_empowers]
  end

  def test_starter_attack_forms_charge_and_paid_attack
    assert_equal [{ kind: "empower", who: "self", targets: "all_attackers", power: 1, face: 0 }], @index["RBF-054"][:attack_forms]
    paid = @index["RBF-061"][:attack_forms].find { |form| form[:targets] == "attacker" }
    assert_equal({ kind: "empower", who: "rubyfront", once: true, attackers: { type: "entity", race: "human" }, targets: "attacker", power: 1, pay_health: 1, face: 0 }, paid)
    muster = @index["RBF-061"][:attack_forms].find { |form| form[:kind] == "heal" }
    assert_equal [1, 2], [muster[:face], muster[:requires_attackers][:count]], "sul Nexus il raduno vuole 2 Umani all'attacco"
  end

  def test_starter_matters_resolve_forms
    assert_equal [{ kind: "empower", targets: "own_entity", race: nil, counter: 1, untap: true }], @index["RBF-057"][:resolve_forms]
    assert_equal [{ kind: "weaken", target: { type: "entity", controller: "opponent", attacking: false }, amount: -2, per_armed: false, then_retire_at_most: 0 }], @index["RBF-058"][:resolve_forms]
    assert_equal [{ kind: "move", target: { type: "entity", controller: "opponent", max_cost: nil }, to: "abisso", discount: nil }], @index["RBF-059"][:resolve_forms]
    assert_equal "d6", @index["RBF-059"][:flux_die]
    assert_nil @index["RBF-059"][:flux_cost]
  end

  def test_starter_static_listens_to_human_entries
    assert_equal [{ entering_race: "human", count: 1, may_bottom: true }], @index["RBF-060"][:enter_peeks]
    assert_equal [{ entering_race: "human", requires: nil, draw: 1, requires_entered: { count: 2, race: "human" } }], @index["RBF-060"][:enter_listeners]
    assert_equal [], @index["RBF-003"][:enter_peeks], "l'ascoltatore che pesca non guarda in cima"
  end

  def test_starter_rubyfront_nexus_and_abilities
    assert_equal({ face: 1, conditions: [{ count: 3, type: "entity", race: "human", attacked: true }], discard: { count: 1, type: "entity", race: "human" }, retire: nil, recovery: 5 }, @index["RBF-061"][:nexus])
    forms = @index["RBF-061"][:abilities].to_h { |ability| [ability[:id], ability[:form]] }
    assert_equal({ kind: "summon", race: "human", grants: [], bonus: nil, max_cost: 2 }, forms["oath-call"], "la chiamata entro il costo 2, senza promessa")
    assert_equal({ kind: "power", amount: 1, targets: "all", race: "human", attacking: false, armed: false, grants: ["surge"] }, forms["oath-charge"], "+1 e Slancio a tutti gli Umani")
    assert_equal({ kind: "power", amount: 1, targets: "one", race: "human", attacking: false, armed: false }, forms["pact-word"])
  end

  def test_attack_drawer_draws_when_attacking_armed
    assert_equal [], @index["RBF-026"][:attack_draws], "dal 2026-09-17 niente pesca all'attacco: resta la ricerca a inizio turno"
    assert_equal [{ requires: "no_object_on_own_front", type: "object", from: "deck", to: "hand", shuffle: true }], @index["RBF-026"][:turn_start_searches], "la ricerca a inizio turno, certificata dal 2026-09-17"
    assert_equal [], @index["RBF-024"][:turn_start_searches]
    assert_equal [], @index["RBF-003"][:attack_draws], "l'ascoltatore ascolta gli ingressi, non attacca"
    assert_equal [], @index["RBF-007"][:enter_returns]
    assert_equal [], @index["RBF-007"][:attack_returns]
  end

  def test_seeker_looks_at_four_cards
    assert_equal [{ count: 4, die: nil, count_base: 0, reveal: { type: "entity", race: "human" }, then_retire: false }], @index["RBF-006"][:enter_looks]
  end

  def test_second_deck_die_glance_no_longer_certified
    assert_equal [], @index["RBF-027"][:enter_looks], "dal 2026-09-10 lo sguardo col dado è del Guardiano"
    assert_equal [{ self: true, max_cost: 2 }], @index["RBF-027"][:enter_rearms], "dal 2026-09-10 il riarmo su di sé all'ingresso; dal 2026-09-17 (bilanciamento) entro il costo 2"
    assert_equal [{ count: 4, die: nil, count_base: 0, reveal: { type: "object", race: nil }, then_retire: true }], @index["RBF-025"][:enter_looks], "dal 2026-09-17 le prime 4, senza dado"
  end

  def test_rallier_takes_control_until_end_of_turn
    assert_equal [{ target: { type: "entity", controller: "opponent", max_cost: 3 }, grants: ["surge"] }], @index["RBF-009"][:enter_controls]
    assert_equal [], @index["RBF-007"][:enter_controls]
  end

  # --- il costo di schieramento (§3.1) ------------------------------------

  def test_knows_fixed_or_die_deployment_cost
    assert_equal({ fixed: 3, die: nil }, @index["RBF-023"][:deployment])
    assert_equal({ fixed: nil, die: 6 }, @index["RBF-001"][:deployment])
    assert_nil @index["RBF-004"][:deployment], "un'Entità non si schiera"
    assert_equal({ fixed: 2, die: nil }, Rubyfront::CardIndex.deployment_of(2))
    assert_nil Rubyfront::CardIndex.deployment_of({ "die" => "dado" })
  end

  # --- Materie e abilitazioni (§7) ----------------------------------------

  def test_knows_matter_type_and_grade
    assert_equal({ type: "dimensional", grade: 1 }, @index["RBF-036"][:matter])
    assert_nil @index["RBF-004"][:matter], "un'Entità non è una Materia"
  end

  def test_knows_enables_per_face
    assert_equal [[{ type: "dynamic", max_grade: 1 }]], @index["RBF-004"][:enables]
    ruby_rf = @index["RBF-023"][:enables]
    assert_equal 2, ruby_rf.size, "Rubyfront e Nexus: una lista per faccia"
    assert_includes ruby_rf[0], { type: "destructive", max_grade: 1 }
    assert_includes ruby_rf[1], { type: "destructive", max_grade: 2 }, "il Nexus abilita di più (§3.1)"
    human_rf = @index["RBF-001"][:enables]
    assert_equal [{ type: "dynamic", max_grade: 2 }, { type: "destructive", max_grade: 1 }], human_rf[0],
                 "dal 2026-09-13 il Rubyfront abilita la Dinamica, non la Dimensionale"
    assert_equal [{ type: "dynamic", max_grade: 2 }, { type: "destructive", max_grade: 2 }], human_rf[1],
                 "e il Nexus pure: il flip non toglie la Dinamica al mazzo"
    assert_equal [[]], @index["RBF-036"][:enables], "una Materia non abilita nulla"
  end

  # --- il costo di Flusso (§3.2) ------------------------------------------

  def test_knows_flux_cost
    assert_equal 2, @index["RBF-004"][:flux_cost]
    assert_equal 2, @index["RBF-036"][:flux_cost], "anche le Materie si pagano"
    assert_nil @index["RBF-023"][:flux_cost], "il Rubyfront ha il costo di schieramento, non di Flusso"
  end

  # --- il comportamento delle Materie (§7.2) ------------------------------

  def test_knows_reactive_matters
    assert_equal "reactive", @index["RBF-036"][:behavior]
    assert_nil @index["RBF-004"][:behavior], "un'Entità non ha comportamento di Materia"
  end

  # --- le statistiche del combattimento (§6.3) ----------------------------

  def test_knows_entity_power
    assert_equal 2, @index["RBF-004"][:power]
    assert_equal 3, @index["RBF-028"][:power]
  end

  def test_knows_counterattack_only_of_holders
    assert_equal 1, @index["RBF-028"][:counterattack]
    assert_nil @index["RBF-004"][:counterattack], "senza la statistica non si contrattacca"
  end

  def test_non_entity_has_no_power
    assert_nil @index["RBF-013"][:power], "un Oggetto non ha Potenza"
    assert_nil @index["RBF-023"][:power], "il Rubyfront non ha Potenza: non attacca (§3.1)"
  end

  def test_non_integer_value_stays_unknown
    assert_nil Rubyfront::CardIndex.integer_stat({ "base" => 3 })
    assert_nil Rubyfront::CardIndex.integer_stat("3")
    assert_equal 3, Rubyfront::CardIndex.integer_stat(3)
  end

  # --- razza e concessioni certificate -----------------------------------

  def test_knows_entity_race
    assert_equal "human", @index["RBF-009"][:race]
    assert_nil @index["RBF-013"][:race], "un Oggetto non ha razza"
  end

  def test_stasis_item_grants_stasis_to_humans
    grants = @index["RBF-013"][:grants_while_assigned]
    assert_equal 1, grants.size, "RBF-013 ha una sola concessione certificata"
    assert_equal ["stasis"], grants.first[:keywords]
    assert_equal "human", grants.first[:if_race]
  end

  def test_only_certified_form_enters_index
    # RBF-013 ha anche un secondo trigger while_assigned (+1 Potenza,
    # modify_power): non è la forma certificata e non deve comparire.
    grants = @index["RBF-013"][:grants_while_assigned]
    assert grants.all? { |grant| grant[:keywords].any? }, "solo empower con grants"
    # E chi non concede nulla ha la lista vuota, mai nil.
    assert_equal [], @index["RBF-009"][:grants_while_assigned]
  end

  # --- L'indice dei mazzi (§4, dal 2026-10-21) --------------------------------

  def test_deck_index_reads_every_deck_with_one_rubyfront
    decks = Rubyfront::CardIndex.load_decks(DATA_DIR, cards: @index)
    refute_empty decks
    files = Dir.glob(File.join(DATA_DIR, "decks", "*.json")).size
    assert_equal files, decks.size, "ogni file dei mazzi entra nell'indice"
    decks.each do |id, deck|
      assert deck[:cards].values.all? { |count| count.is_a?(Integer) && count.positive? }, id
      assert deck[:cards].keys.all? { |card| @index.key?(card) }, "#{id}: ogni carta del mazzo è in anagrafe"
      assert_equal 1, deck[:cards].count { |card, _| @index[card][:type] == "rubyfront" }, "#{id}: un solo Rubyfront"
      assert_equal 1, deck[:cards][deck[:rubyfront]], "#{id}: il Rubyfront è una copia sola"
      assert deck.frozen?
      assert deck[:cards].frozen?
    end
  end

  # --- Le forme dello starter Auros (2026-10-22, engine 0.91.0) ---------------
  # Qui, e solo qui, si indirizza per id: è la prova dell'anagrafe sulle carte vere.

  def test_auros_starter_entry_forms
    assert_equal [{ targets: "opposing_entity", count: 1, max_cost: nil }], @index["RBF-065"][:enter_freezes], "una avversaria in Stasi all'ingresso"
    assert_equal [{ targets: "opposing_entity", count: 2, max_cost: 3, then_heal_per_tapped: 1 }], @index["RBF-069"][:enter_freezes], "due avversarie economiche in Stasi, poi i PV per le tappate"
    assert_equal 5, @index["RBF-069"][:power]
    # Le forme della scheda riletta il 2026-10-23.
    assert_equal [{ entering_race: nil, count: 1, may_bottom: true, self: true }], @index["RBF-062"][:enter_peeks], "lo sguardo in cima sull'ingresso proprio"
    assert_equal ["stasis"], @index["RBF-062"][:keywords]
    assert_equal [{ entering_race: nil, requires: nil, heal: 1, self: true }], @index["RBF-063"][:enter_listeners], "i PV a ogni Entità che entra, compresa questa"
    assert_equal [{ count: 3 }], @index["RBF-064"][:enter_sorts], "il riordino delle prime tre"
    assert_equal [{ kind: "grant_all", grants: ["stasis"] }], @index["RBF-067"][:static_forms], "«le Entità che controlli hanno Stasi»"
    assert_equal [{ scope: "controlled", amount: 1, die: nil, at_least: nil }], @index["RBF-067"][:tap_listeners], "i PV a ogni tappata di una propria Entità"
    assert_equal 3, @index["RBF-067"][:power]
    assert_equal [{ kind: "bearer_power", amount: 1 }], @index["RBF-076"][:static_forms]
    assert_equal [{ scope: "bearer", amount: 1, die: 6, at_least: 4 }], @index["RBF-076"][:tap_listeners], "il d6 alla tappata del portatore"
    assert_empty @index["RBF-065"][:enter_taps], "la Stasi imposta non è «entra tappata»"
    assert_equal [{ targets: "own_entity", in_state: "stasis", optional: true }], @index["RBF-066"][:enter_wakes]
    assert_equal [{ kind: "wake", if_state: "stasis", to_self: true }], @index["RBF-070"][:assign_forms], "l'Oggetto che toglie dalla Stasi chi lo riceve"
    assert_equal [{ kind: "bearer_power", amount: 2 }], @index["RBF-070"][:static_forms]
  end

  def test_auros_starter_resolve_forms
    assert_equal [{ kind: "freeze", target: { type: "entity", controller: "opponent", max_cost: nil }, count: 1 }], @index["RBF-071"][:resolve_forms]
    assert_equal [{ kind: "empower", targets: "own_entity", race: nil, power: 2, untap: false }], @index["RBF-072"][:resolve_forms], "il buff secco della Reattiva, senza stappare"
    assert_equal "reactive", @index["RBF-072"][:behavior]
    assert_equal [{ kind: "search_objects", up_to: 1, type: "object", max_cost: 3, to: "ritiro", else_to: nil, then_roll: { die: 6, at_least: 3, from: "ritiro" }, shuffle: true }], @index["RBF-073"][:resolve_forms], "la ricerca in Ritiro (dal 2026-10-23)"
    assert_equal 2, @index["RBF-073"][:flux_cost]
    assert_equal [{ kind: "sentence", target: { type: "entity", controller: "opponent" }, die: 6, to: "abisso", else_power: -2 }], @index["RBF-077"][:resolve_forms], "la sentenza del dado"
    assert_equal "d6", @index["RBF-077"][:flux_die]
    assert_equal({ type: "destructive", grade: 2 }, @index["RBF-077"][:matter].slice(:type, :grade))
    assert_equal({ type: "dimensional", grade: 2 }, @index["RBF-073"][:matter].slice(:type, :grade))
    assert_equal [{ kind: "exile_timed", target: { type: "entity", controller: "opponent" }, to: "ritiro", turns: 3, die: 12, return_at_least: 8, else_to: "abisso" }], @index["RBF-075"][:resolve_forms]
  end

  def test_auros_starter_rubyfront_listens_to_stasis_and_flips_for_an_object
    rubyfront = @index["RBF-074"]
    assert_equal [{ face: 0, amount: 1, any: true }, { face: 1, amount: 2, any: true }], rubyfront[:stasis_listeners], "+1 PV sulla faccia A, +2 sul Nexus"
    assert_equal({ face: 1, conditions: [{ count: 2, type: "entity", race: nil, inflicted: true }], discard: nil, retire: { count: 1, type: "object" }, recovery: 5 }, rubyfront[:nexus])
    forms = rubyfront[:abilities].to_h { |ability| [ability[:id], ability[:form]] }
    assert_equal({ kind: "grant", grants: ["stasis"], until: "controller_next_turn" }, forms["hold"])
    assert_equal({ kind: "untap", race: nil, power: nil }, forms["wake"])
    assert_equal({ kind: "grant", grants: ["stasis"], until: "permanent" }, forms["vigil-hold"])
    assert_equal({ kind: "untap", race: "auros", power: 2 }, forms["vigil-wake"])
    assert_equal({ kind: "freeze", min: 0, max: 2 }, forms["vigil-seal"])
    assert rubyfront[:abilities].find { |ability| ability[:id] == "hold" }[:fury], "la Furia precede le abilità della faccia A"
    refute rubyfront[:abilities].find { |ability| ability[:id] == "vigil-seal" }[:fury]
  end

  def test_stasis_forms_of_another_shape_stay_unknown
    # Una «tappata» imposta a un'avversaria non è né «entra tappata» né la Stasi: ignota, e il tavolo la ignora.
    tapped = { "id" => "x", "event" => "on_enter_field", "effect" => { "type" => "set_state", "state" => "tapped", "target" => { "cardType" => "entity", "controller" => "opponent", "min" => 1, "max" => 1 } } }
    refute Rubyfront::CardIndex.recognized?(tapped)
    # La Stasi su una propria Entità all'ingresso: non è la forma certificata.
    own = { "id" => "x", "event" => "on_enter_field", "effect" => { "type" => "set_state", "state" => "stasis", "target" => { "cardType" => "entity", "controller" => "controller", "min" => 1, "max" => 1 } } }
    refute Rubyfront::CardIndex.recognized?(own)
    # «Fino a 2» all'ingresso (min diverso da max) non è certificato: l'ingresso ne mette tante quante dice.
    loose = { "id" => "x", "event" => "on_enter_field", "effect" => { "type" => "set_state", "state" => "stasis", "target" => { "cardType" => "entity", "controller" => "opponent", "min" => 0, "max" => 2 } } }
    refute Rubyfront::CardIndex.recognized?(loose)
    # L'esilio a tempo con un dado ignoto o senza il ritorno sul Fronte resta ignoto.
    odd = { "id" => "x", "event" => "on_resolve", "effect" => { "type" => "move_card", "target" => { "cardType" => "entity", "controller" => "opponent", "min" => 1, "max" => 1 },
                                                                "destination" => { "zone" => "retire", "owner" => "card_owner" },
                                                                "details" => { "forTurns" => 3, "turnsOf" => "target_controller", "thenRoll" => { "die" => "dado", "returnAtLeast" => 8, "returnTo" => { "zone" => "front", "owner" => "card_owner" }, "otherwise" => { "zone" => "abyss", "owner" => "card_owner" } } } } }
    refute Rubyfront::CardIndex.recognized?(odd)
    # Un'abilità di forma ignota resta a mano (form nil), e il Nexus con un costo d'altra forma non si legge.
    assert_nil Rubyfront::CardIndex.ability_form({ "type" => "set_state", "state" => "tapped", "target" => { "cardType" => "entity", "controller" => "opponent", "min" => 0, "max" => 2 } })
    assert_nil Rubyfront::CardIndex.ability_form({ "type" => "empower", "target" => { "cardType" => "entity", "controller" => "controller", "min" => 1, "max" => 1 }, "grants" => ["stasis"], "duration" => "until_end_of_turn" })
  end

  def test_deck_index_knows_access_and_composition_size
    decks = Rubyfront::CardIndex.load_decks(DATA_DIR, cards: @index)
    assert decks.values.any? { |deck| deck[:access] == "free" }
    decks.each do |id, deck|
      total = deck[:cards].values.sum
      assert total.between?(20, 80), "#{id}: #{total} carte"
    end
  end

  def test_deck_index_skips_broken_files
    Dir.mktmpdir do |dir|
      FileUtils.mkdir_p(File.join(dir, "decks"))
      File.write(File.join(dir, "decks", "rotto.json"), "{ non json")
      File.write(File.join(dir, "decks", "vuoto.json"), JSON.generate({ "id" => "vuoto", "cards" => [] }))
      File.write(File.join(dir, "decks", "senza-id.json"), JSON.generate({ "cards" => [{ "card" => "RBF-001", "count" => 1 }] }))
      File.write(File.join(dir, "decks", "ok.json"), JSON.generate({ "id" => "ok", "access" => "free", "cards" => [{ "card" => "RBF-001", "count" => 1 }, { "card" => "RBF-002", "count" => 2 }, { "card" => "RBF-002", "count" => 1 }, { "card" => "RBF-003", "count" => 0 }] }))
      decks = Rubyfront::CardIndex.load_decks(dir, cards: @index)
      assert_equal ["ok"], decks.keys
      assert_equal({ "RBF-001" => 1, "RBF-002" => 3 }, decks["ok"][:cards], "le voci ripetute si sommano, le quantità a zero cadono")
      assert_equal "free", decks["ok"][:access]
    end
  end
end
